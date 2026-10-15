import { randomUUID } from 'node:crypto';

import { type ReturnType, type SyncCursor, type SyncKind, type SyncRun, SyncStatus } from '@hexabuild/shared';

import { db } from '../db/index.ts';
import { nowIso } from '../lib/time.ts';

type Row = Record<string, unknown>;

const str = (value: unknown) => (value === null || value === undefined ? null : String(value));

export interface RunCounts {
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
}

export const emptyCounts = (): RunCounts => ({ fetched: 0, created: 0, updated: 0, unchanged: 0, failed: 0 });

function toRun(row: Row): SyncRun {
  return {
    id: String(row.id),
    account: str(row.account),
    kind: row.kind as SyncKind,
    status: row.status as SyncStatus,
    startedAt: String(row.started_at),
    finishedAt: str(row.finished_at),
    windowFrom: str(row.window_from),
    windowTo: str(row.window_to),
    fetched: Number(row.fetched),
    created: Number(row.created),
    updated: Number(row.updated),
    unchanged: Number(row.unchanged),
    failed: Number(row.failed),
    error: str(row.error),
  };
}

export function startRun(account: string | null, kind: SyncKind, windowFrom: Date | null, windowTo: Date | null): string {
  const id = randomUUID();

  db.prepare(
    `INSERT INTO sync_runs (id, account, kind, status, started_at, window_from, window_to)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, account, kind, SyncStatus.RUNNING, nowIso(), windowFrom?.toISOString() ?? null, windowTo?.toISOString() ?? null);

  return id;
}

/** Records which account a lookup run ended up finding the return in. */
export function setRunAccount(id: string, account: string) {
  db.prepare('UPDATE sync_runs SET account = ? WHERE id = ?').run(account, id);
}

export function finishRun(id: string, status: SyncStatus, counts: RunCounts, error: string | null = null) {
  db.prepare(
    `UPDATE sync_runs SET status = :status, finished_at = :finishedAt, fetched = :fetched, created = :created,
       updated = :updated, unchanged = :unchanged, failed = :failed, error = :error
     WHERE id = :id`
  ).run({ id, status, finishedAt: nowIso(), error, ...counts });
}

/** Runs left RUNNING by a crash or restart can never finish; mark them failed. */
export function failOrphanedRuns() {
  db.prepare(`UPDATE sync_runs SET status = ?, finished_at = ?, error = ? WHERE status = ?`).run(
    SyncStatus.FAILED,
    nowIso(),
    'Server stopped during sync',
    SyncStatus.RUNNING
  );
}

export function listRuns(limit: number): SyncRun[] {
  return db.prepare('SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT ?').all(limit).map(toRun);
}

export function lastSuccessAt(): string | null {
  const row = db
    .prepare(`SELECT finished_at FROM sync_runs WHERE status IN (?, ?) ORDER BY finished_at DESC LIMIT 1`)
    .get(SyncStatus.SUCCESS, SyncStatus.PARTIAL);

  return str(row?.finished_at);
}

export function getCursor(account: string, type: ReturnType): Date | null {
  const row = db.prepare('SELECT last_updated_to FROM sync_cursors WHERE account = ? AND type = ?').get(account, type);

  return row ? new Date(String(row.last_updated_to)) : null;
}

export function setCursor(account: string, type: ReturnType, to: Date) {
  db.prepare(
    `INSERT INTO sync_cursors (account, type, last_updated_to) VALUES (?, ?, ?)
     ON CONFLICT (account, type) DO UPDATE SET last_updated_to = excluded.last_updated_to`
  ).run(account, type, to.toISOString());
}

export function listCursors(accounts: string[]): SyncCursor[] {
  return db
    .prepare('SELECT account, type, last_updated_to FROM sync_cursors ORDER BY account, type')
    .all()
    .filter(row => accounts.includes(String(row.account)))
    .map(row => ({ account: String(row.account), type: row.type as ReturnType, lastUpdatedTo: String(row.last_updated_to) }));
}
