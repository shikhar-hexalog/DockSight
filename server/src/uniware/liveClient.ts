// Read-only Uniware client. Calls only oauth/token, return/search and return/get.

import { ReturnType } from '@hexabuild/shared';

import { type UniwareAccount, config } from '../config.ts';
import { sleep } from '../lib/async.ts';
import {
  SaleOrderStatus,
  type SearchWindow,
  type UniwareClient,
  UniwareError,
  type UniwareOrderHit,
  type UniwareReturnDetail,
  type UniwareSaleOrder,
  type UniwareSearchHit,
} from './types.ts';

const RETURN_SEARCH_PATH = '/services/rest/v1/oms/return/search';

const RETURN_GET_PATH = '/services/rest/v1/oms/return/get';

const ORDER_SEARCH_PATH = '/services/rest/v1/oms/saleOrder/search';

const ORDER_GET_PATH = '/services/rest/v1/oms/saleorder/get';

// One page of cancelled orders per check; a few minutes of cancellations fit easily.
const ORDER_PAGE_SIZE = 500;

const CODE_KEY = {
  SHIPMENT: 'shipmentCode',
  REVERSE_PICKUP: 'reversePickupCode',
} as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n: number) => String(n).padStart(2, '0');

// Uniware reads search dates as UTC (its responses are in local time). Sending
// local time shifted every window 5h30m into the future in India, so short
// incremental windows found nothing; long backfill windows were just shifted.
const time = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

// The docs show two date formats: the sample uses ISO, the field table uses
// dd-MMM-yyyy. We try both once and remember the one that works.
const DATE_FORMATS = [
  (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${time(d)}`,
  (d: Date) => `${pad(d.getUTCDate())}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()} ${time(d)}`,
];

// Refresh the token this long before Uniware says it expires.
const TOKEN_EXPIRY_MARGIN_MS = 5 * 60 * 1000;

interface Token {
  value: string;
  expiresAt: number;
}

export class LiveUniwareClient implements UniwareClient {
  private readonly baseUrl: string;

  private token: Token | null = null;

  private tokenRequest: Promise<Token> | null = null;

  private dateFormatIndex: number | null = null;

  constructor(private readonly account: UniwareAccount) {
    this.baseUrl = account.baseUrl;
  }

  async searchReturns(type: ReturnType, window: SearchWindow): Promise<UniwareSearchHit[]> {
    const formats = this.dateFormatIndex === null ? DATE_FORMATS.map((_, i) => i) : [this.dateFormatIndex];

    let lastError: unknown;

    for (const index of formats) {
      const format = DATE_FORMATS[index];

      try {
        const body = await this.post<{ returnOrders?: UniwareSearchHit[] }>(RETURN_SEARCH_PATH, {
          returnType: type,
          [`${window.field}From`]: format(window.from),
          [`${window.field}To`]: format(window.to),
        });

        this.dateFormatIndex = index;

        return body.returnOrders ?? [];
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError;
  }

  // The docs don't say whether a search code is a reverse pickup code or a
  // shipment code, so try the likely key for the type first.
  async getReturn(code: string, type: ReturnType): Promise<UniwareReturnDetail> {
    const keys =
      type === ReturnType.CIR
        ? [CODE_KEY.REVERSE_PICKUP, CODE_KEY.SHIPMENT]
        : [CODE_KEY.SHIPMENT, CODE_KEY.REVERSE_PICKUP];

    let lastError: unknown = new UniwareError(`return/get: no items for ${code}`);

    for (const key of keys) {
      try {
        const detail = await this.post<UniwareReturnDetail>(RETURN_GET_PATH, { [key]: code });

        if ((detail.returnSaleOrderItems?.length ?? 0) > 0) {
          return detail;
        }
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError;
  }

  async findReturn(code: string): Promise<UniwareReturnDetail | null> {
    for (const key of [CODE_KEY.SHIPMENT, CODE_KEY.REVERSE_PICKUP]) {
      try {
        const detail = await this.post<UniwareReturnDetail>(RETURN_GET_PATH, { [key]: code });

        if ((detail.returnSaleOrderItems?.length ?? 0) > 0) {
          return detail;
        }
      } catch (err) {
        if (err instanceof UniwareError && err.retryable) {
          throw err;
        }
      }
    }

    return null;
  }

  async searchCancelledOrders(minutes: number): Promise<UniwareOrderHit[]> {
    const body = await this.post<{ elements?: UniwareOrderHit[] }>(ORDER_SEARCH_PATH, {
      status: SaleOrderStatus.CANCELLED,
      updatedSinceInMinutes: minutes,
      facilityCodes: [this.account.facility],
      searchOptions: { displayStart: 0, displayLength: ORDER_PAGE_SIZE },
    });

    return body.elements ?? [];
  }

  async getSaleOrder(code: string): Promise<UniwareSaleOrder> {
    const body = await this.post<{ saleOrderDTO?: UniwareSaleOrder }>(ORDER_GET_PATH, {
      code,
      facilityCodes: [this.account.facility],
    });

    return body.saleOrderDTO ?? {};
  }

  private async post<T>(path: string, payload: Record<string, unknown>): Promise<T> {
    let attempt = 0;

    while (true) {
      try {
        return await this.request<T>(path, payload);
      } catch (err) {
        attempt++;

        const retryable = err instanceof UniwareError && err.retryable;

        if (!retryable || attempt >= config.uniware.maxRetries) {
          throw err;
        }

        await sleep((err as UniwareError).retryAfterMs ?? 500 * 2 ** attempt);
      }
    }
  }

  private async request<T>(path: string, payload: Record<string, unknown>): Promise<T> {
    const token = await this.getToken();

    let res: Response;

    try {
      res = await fetch(this.baseUrl + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `bearer ${token.value}`,
          Facility: this.account.facility,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(config.uniware.requestTimeoutMs),
      });
    } catch (err) {
      throw new UniwareError(`${path}: network error (${(err as Error).message})`, null, true);
    }

    if (res.status === 401) {
      this.token = null;
      throw new UniwareError(`${path}: token rejected`, 401, true);
    }

    // Uniware answers 403 with an HTML page when the logged-in user may not use the API.
    if (res.status === 403) {
      throw new UniwareError(
        `${path}: HTTP 403. Uniware refused this user API access. The user must be an Admin with access to facility "${this.account.facility}" (and the account may restrict API use by IP).`,
        403
      );
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : config.uniware.errorBackoffMs;
      throw new UniwareError(`${path}: rate limited`, 429, true, waitMs);
    }

    const text = await res.text();

    let body: { successful?: boolean; errors?: unknown; message?: string };

    try {
      body = JSON.parse(text);
    } catch {
      throw new UniwareError(`${path}: HTTP ${res.status}, response was not JSON`, res.status, res.status >= 500);
    }

    if (!res.ok || body.successful === false) {
      const retryable = res.status >= 500;
      throw new UniwareError(`${path}: HTTP ${res.status} ${JSON.stringify(body.errors ?? body.message)}`, res.status, retryable);
    }

    return body as T;
  }

  private async getToken(): Promise<Token> {
    if (this.token && Date.now() < this.token.expiresAt) {
      return this.token;
    }

    // Parallel requests share one login.
    this.tokenRequest ??= this.login().finally(() => {
      this.tokenRequest = null;
    });

    this.token = await this.tokenRequest;

    return this.token;
  }

  private async login(): Promise<Token> {
    const url = new URL('/oauth/token', this.baseUrl);

    url.search = new URLSearchParams({
      grant_type: 'password',
      client_id: 'my-trusted-client',
      username: this.account.username,
      password: this.account.password,
    }).toString();

    let res: Response;

    try {
      // POST with query params, as the reporting service does in production
      // (the docs show GET).
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(config.uniware.requestTimeoutMs),
      });
    } catch (err) {
      throw new UniwareError(`Login: network error (${(err as Error).message})`, null, true);
    }

    if (!res.ok) {
      throw new UniwareError(
        `Login failed for account ${this.account.key}: HTTP ${res.status}. Check its tenant, username and password.`,
        res.status
      );
    }

    const body = (await res.json()) as { access_token: string; expires_in: number };

    return {
      value: body.access_token,
      expiresAt: Date.now() + body.expires_in * 1000 - TOKEN_EXPIRY_MARGIN_MS,
    };
  }
}
