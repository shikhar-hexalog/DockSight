// One AI service (OpenAI, Gemini, Meta): how to find its models and how to
// make one call. The router decides which engine and model to use, and what
// to do when a call fails.

import type { AiRequest } from '../types.ts';

/** What went wrong with one call, which tells the router what to try next. */
export const Failure = {
  /** Overloaded, rate-limited, timed out: try another model, this one again later. */
  BUSY: 'busy',
  /** This model's quota is used up: leave it alone for a while. */
  QUOTA: 'quota',
  /** Bad key, no billing, no credit: nothing on this engine will work for a while. */
  ACCOUNT: 'account',
  /** The model is retired or not available to this key. */
  GONE: 'gone',
  /** This model couldn't take the request (e.g. an unsupported schema): try another. */
  REJECTED: 'rejected',
  /** A garbled or cut-off answer: usually a one-off, try another model. */
  GARBLED: 'garbled',
} as const;

export type Failure = (typeof Failure)[keyof typeof Failure];

export type Outcome<T> = { ok: true; value: T } | { ok: false; failure: Failure; reason: string; retryAfterMs?: number };

/**
 * How long the engine asked us to wait, from a Retry-After header ("7") or a
 * rate-limit reset header ("7.66s", "1m2.5s"). Null when it didn't say.
 */
export function waitFromHeaders(headers: Headers): number | null {
  const seconds = Number(headers.get('retry-after'));

  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  const resets = ['x-ratelimit-reset-tokens', 'x-ratelimit-reset-requests'].map(name => headers.get(name)).filter(Boolean) as string[];

  const ms = resets.map(text => {
    const match = /^(?:(\d+)m)?(?:([\d.]+)s)?$/.exec(text);

    return match ? (Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)) * 1000 : NaN;
  });

  const finite = ms.filter(Number.isFinite);

  return finite.length > 0 ? Math.min(...finite) : null;
}

export type EngineName = 'groq' | 'gemini' | 'meta' | 'openai';

export interface Engine {
  name: EngineName;
  /** The API key from .env, if there is one. */
  key(): string | undefined;
  /** Every model id the key can use, straight from the engine's model list. */
  listModels(key: string): Promise<string[]>;
  /** The models to use from that list for requests with images, best first. */
  pickModels(ids: string[]): string[];
  /** Models for text-only requests (briefs, questions), when the engine has better ones for text. */
  pickTextModels?(ids: string[]): string[];
  call<T>(model: string, key: string, request: AiRequest): Promise<Outcome<T>>;
}

/** A version like "5.4" or "3" as numbers, for sorting newest first. */
export function versionOf(text: string): number[] {
  return text.split('.').map(Number);
}

export function newerFirst(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0);

    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

/**
 * The newest model of each tier, in tier order. `match` returns the tier and
 * version for a usable id, or null to leave it out.
 */
export function newestPerTier(ids: string[], tiers: string[], match: (id: string) => { tier: string; version: number[] } | null): string[] {
  const best = new Map<string, { id: string; version: number[] }>();

  for (const id of ids) {
    const found = match(id);

    if (!found || !tiers.includes(found.tier)) {
      continue;
    }

    const current = best.get(found.tier);

    if (!current || newerFirst(found.version, current.version) < 0) {
      best.set(found.tier, { id, version: found.version });
    }
  }

  return tiers.flatMap(tier => (best.has(tier) ? [best.get(tier)!.id] : []));
}

const MIME_FOR: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

export function mimeFor(name: string): string {
  return MIME_FOR[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'image/jpeg';
}

// A model that hasn't answered in 15s is stuck; the next one is faster than waiting.
export const CALL_TIMEOUT_MS = 15_000;

/** A fetch that turns a timeout or network error into a BUSY outcome. */
export async function post(url: string, headers: Record<string, string>, body: string): Promise<Response | Outcome<never>> {
  try {
    return await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
  } catch (error) {
    const timedOut = (error as Error).name === 'TimeoutError';

    return { ok: false, failure: Failure.BUSY, reason: timedOut ? 'timed out' : `network error: ${(error as Error).message}` };
  }
}
