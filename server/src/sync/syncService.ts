// Keeps our database in step with every configured Uniware account.
//
// 1. Backfill: an account with no cursor yet loads the last BACKFILL_DAYS.
// 2. Incremental: every SYNC_INTERVAL_MIN, each account fetches returns
//    updated since its cursor (minus a small overlap) and upserts them.
// 3. Lookup: a scanned code we don't know is fetched from Uniware on the
//    spot, trying each account in turn.
//
// Accounts sync one after another and independently: one failing never
// stops the others. Only one sync runs at a time. A cursor only moves
// forward when every return in its window was fetched, so failures are
// retried next run.

import { RETURN_TYPES, type ReturnType, SyncKind, SyncStatus, type SyncStatusResponse } from '@hexabuild/shared';

import { type UniwareAccount, config } from '../config.ts';
import { mapWithLimit } from '../lib/async.ts';
import { DAY_MS, MINUTE_MS, splitWindow } from '../lib/time.ts';
import { findReturnIdByCode, upsertReturn } from '../repo/returnsRepo.ts';
import {
  type RunCounts,
  emptyCounts,
  failOrphanedRuns,
  finishRun,
  getCursor,
  lastSuccessAt,
  listCursors,
  listRuns,
  setCursor,
  setRunAccount,
  startRun,
} from '../repo/syncRepo.ts';
import { inferType, toReturnRecord } from '../uniware/mapper.ts';
import { SearchDateField, type UniwareClient, UniwareError } from '../uniware/types.ts';

// Uniware's search accepts at most 30 days per call; stay just under.
const MAX_WINDOW_DAYS = 29;

const RECENT_RUNS = 30;

export interface SyncSource {
  account: UniwareAccount;
  client: UniwareClient;
}

function runStatus(errorCount: number, counts: RunCounts): SyncStatus {
  if (errorCount === 0) {
    return SyncStatus.SUCCESS;
  }

  return counts.fetched > counts.failed ? SyncStatus.PARTIAL : SyncStatus.FAILED;
}

function addCounts(total: RunCounts, part: RunCounts) {
  for (const key of Object.keys(total) as (keyof RunCounts)[]) {
    total[key] += part[key];
  }
}

const neverSynced = (account: UniwareAccount) => RETURN_TYPES.some(type => getCursor(account.key, type) === null);

export class SyncBusyError extends Error {
  constructor() {
    super('A sync is already running');
  }
}

export class SyncService {
  private running = false;

  private timer: NodeJS.Timeout | null = null;

  private nextRunAt: Date | null = null;

  constructor(private readonly sources: SyncSource[]) {}

  /** Catches every account up (backfilling new ones), then syncs on a schedule. */
  async start() {
    failOrphanedRuns();

    try {
      await this.incremental();
    } catch (err) {
      console.error(`[sync] startup sync failed: ${(err as Error).message}`);
    }

    this.schedule();
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }

  /** Reloads the last BACKFILL_DAYS for every account. */
  backfill(): Promise<RunCounts> {
    return this.exclusive(() => SyncKind.BACKFILL);
  }

  /** Fetches recent changes; an account that has never synced gets a backfill instead. */
  incremental(): Promise<RunCounts> {
    return this.exclusive(account => (neverSynced(account) ? SyncKind.BACKFILL : SyncKind.INCREMENTAL));
  }

  /**
   * Finds a return by a scanned code: our database first, then each Uniware
   * account. Returns our return id, or null when no account knows it.
   */
  async lookup(code: string): Promise<{ id: string; fromUniware: boolean } | null> {
    const localId = findReturnIdByCode(code);

    if (localId) {
      return { id: localId, fromUniware: false };
    }

    const runId = startRun(null, SyncKind.LOOKUP, null, null);

    const counts = emptyCounts();

    const errors: string[] = [];

    for (const { account, client } of this.sources) {
      try {
        const detail = await client.findReturn(code);

        const identity = detail ? inferType(detail) : null;

        if (!detail || !identity) {
          continue;
        }

        counts.fetched = 1;

        counts[upsertReturn(account, toReturnRecord(detail, identity.type, identity.code))] += 1;

        setRunAccount(runId, account.key);

        finishRun(runId, SyncStatus.SUCCESS, counts);

        const id = findReturnIdByCode(identity.code);

        return id ? { id, fromUniware: true } : null;
      } catch (err) {
        errors.push(`${account.key}: ${(err as Error).message}`);
      }
    }

    // Not found anywhere. If every account errored, we don't actually know that.
    const allFailed = errors.length === this.sources.length;

    finishRun(runId, allFailed ? SyncStatus.FAILED : SyncStatus.SUCCESS, counts, errors[0] ?? null);

    return null;
  }

  status(): SyncStatusResponse {
    const accounts = this.sources.map(({ account }) => ({
      key: account.key,
      tenant: account.tenant,
      facility: account.facility,
    }));

    return {
      mode: config.uniware.mode,
      accounts,
      incompleteAccounts: config.uniware.incompleteAccounts,
      running: this.running,
      intervalMinutes: config.sync.intervalMinutes,
      lastSuccessAt: lastSuccessAt(),
      nextRunAt: this.nextRunAt?.toISOString() ?? null,
      cursors: listCursors(accounts.map(a => a.key)),
      runs: listRuns(RECENT_RUNS),
    };
  }

  private schedule() {
    const delay = config.sync.intervalMinutes * MINUTE_MS;

    this.nextRunAt = new Date(Date.now() + delay);

    this.timer = setTimeout(async () => {
      try {
        await this.incremental();
      } catch (err) {
        if (!(err instanceof SyncBusyError)) {
          console.error(`[sync] scheduled sync failed: ${(err as Error).message}`);
        }
      }

      this.schedule();
    }, delay);
  }

  /** Runs one sync per account, one account at a time, and never two syncs at once. */
  private async exclusive(kindFor: (account: UniwareAccount) => SyncKind): Promise<RunCounts> {
    if (this.running) {
      throw new SyncBusyError();
    }

    this.running = true;

    const total = emptyCounts();

    try {
      for (const source of this.sources) {
        addCounts(total, await this.syncAccount(source, kindFor(source.account)));
      }

      return total;
    } finally {
      this.running = false;
    }
  }

  private async syncAccount({ account, client }: SyncSource, kind: SyncKind): Promise<RunCounts> {
    const to = new Date();

    const from = this.windowStart(account, kind, to);

    const field = kind === SyncKind.BACKFILL ? SearchDateField.CREATED : SearchDateField.UPDATED;

    const runId = startRun(account.key, kind, from, to);

    const counts = emptyCounts();

    const errors: string[] = [];

    try {
      for (const type of RETURN_TYPES) {
        const typeFailed = await this.syncType(account, client, type, { from, to, field }, counts, errors);

        if (!typeFailed) {
          setCursor(account.key, type, to);
        }
      }

      const status = runStatus(errors.length, counts);

      finishRun(runId, status, counts, errors[0] ?? null);

      console.log(
        `[sync] ${account.key} ${kind} ${status}: ${counts.fetched} fetched, ${counts.created} new, ` +
          `${counts.updated} updated, ${counts.failed} failed`
      );
    } catch (err) {
      finishRun(runId, SyncStatus.FAILED, counts, (err as Error).message);

      console.error(`[sync] ${account.key} ${kind} failed: ${(err as Error).message}`);
    }

    return counts;
  }

  private windowStart(account: UniwareAccount, kind: SyncKind, to: Date): Date {
    const backfillStart = to.getTime() - config.sync.backfillDays * DAY_MS;

    if (kind === SyncKind.BACKFILL) {
      return new Date(backfillStart);
    }

    const cursors = RETURN_TYPES.map(type => getCursor(account.key, type)?.getTime() ?? backfillStart);

    return new Date(Math.min(...cursors) - config.sync.overlapMinutes * MINUTE_MS);
  }

  /** Syncs one return type of one account. Returns true if anything failed. */
  private async syncType(
    account: UniwareAccount,
    client: UniwareClient,
    type: ReturnType,
    range: { from: Date; to: Date; field: SearchDateField },
    counts: RunCounts,
    errors: string[]
  ): Promise<boolean> {
    let failed = false;

    // Collect codes from every window first: a return can match two windows,
    // and we only want to fetch it once.
    const codes = new Set<string>();

    for (const window of splitWindow(range.from, range.to, MAX_WINDOW_DAYS)) {
      try {
        const hits = await client.searchReturns(type, { field: range.field, ...window });

        for (const hit of hits) {
          codes.add(hit.code);
        }
      } catch (err) {
        errors.push(`${type} search: ${(err as Error).message}`);
        failed = true;
      }
    }

    counts.fetched += codes.size;

    await mapWithLimit([...codes], config.uniware.maxConcurrency, async code => {
      try {
        const detail = await client.getReturn(code, type);

        counts[upsertReturn(account, toReturnRecord(detail, type, code))] += 1;
      } catch (err) {
        counts.failed += 1;
        errors.push(`${type} ${code}: ${(err as Error).message}`);

        // Only a temporary failure (network, timeout, Uniware down) holds the
        // cursor back for a retry. A return Uniware refuses outright (e.g.
        // "invalid reverse pickup code") would otherwise make every later
        // sync re-read the whole window, forever.
        failed ||= !(err instanceof UniwareError) || err.retryable;
      }
    });

    return failed;
  }
}
