// Holds raised by the cancellation guard, and checks at the handover desk.

import { randomUUID } from 'node:crypto';

import {
  type DispatchHold,
  type HandoverCheck,
  type HandoverCheckResult,
  HandoverResult,
  HoldStatus,
  PulledVia,
  handoverResultFor,
  normalizeCode,
} from '@hexabuild/shared';

import { db, transaction } from '../db/index.ts';
import { nowIso } from '../lib/time.ts';

type Row = Record<string, unknown>;

const str = (value: unknown) => (value === null || value === undefined ? null : String(value));

function toHold(row: Row): DispatchHold {
  return {
    id: String(row.id),
    account: String(row.account),
    saleOrderCode: String(row.sale_order_code),
    packageCode: String(row.package_code),
    trackingNumber: str(row.tracking_number),
    manifestCode: str(row.manifest_code),
    courier: str(row.courier),
    itemCount: Number(row.item_count),
    firstItemName: str(row.first_item_name),
    cancellationReason: str(row.cancellation_reason),
    cancelledAt: String(row.cancelled_at),
    detectedAt: String(row.detected_at),
    status: row.status as HoldStatus,
    pulledAt: str(row.pulled_at),
    pulledBy: str(row.pulled_by),
    pulledVia: str(row.pulled_via) as PulledVia | null,
    missedAt: str(row.missed_at),
  };
}

export interface HoldCandidate {
  account: string;
  saleOrderCode: string;
  packageCode: string;
  trackingNumber: string | null;
  manifestCode: string | null;
  courier: string | null;
  itemCount: number;
  firstItemName: string | null;
  cancellationReason: string | null;
  cancelledAt: string;
  /** When Uniware shows it dispatched, if it has been. */
  dispatchedAt: string | null;
}

export const HoldOutcome = {
  CREATED: 'created',
  MISSED: 'missed',
  UNCHANGED: 'unchanged',
} as const;

export type HoldOutcome = (typeof HoldOutcome)[keyof typeof HoldOutcome];

/**
 * Records a cancelled, manifested package. New ones open a hold (or go
 * straight to missed if already dispatched); an open hold whose package has
 * since been dispatched becomes missed. Pulled holds are never reopened.
 */
export function upsertHold(candidate: HoldCandidate): HoldOutcome {
  return transaction(() => {
    const existing = db
      .prepare('SELECT id, status FROM dispatch_holds WHERE account = ? AND package_code = ?')
      .get(candidate.account, candidate.packageCode);

    if (!existing) {
      const missed = candidate.dispatchedAt !== null;

      db.prepare(
        `INSERT INTO dispatch_holds (id, account, sale_order_code, package_code, tracking_number, manifest_code, courier,
           item_count, first_item_name, cancellation_reason, cancelled_at, detected_at, status, missed_at)
         VALUES (:id, :account, :saleOrderCode, :packageCode, :trackingNumber, :manifestCode, :courier,
           :itemCount, :firstItemName, :cancellationReason, :cancelledAt, :detectedAt, :status, :missedAt)`
      ).run({
        id: randomUUID(),
        account: candidate.account,
        saleOrderCode: candidate.saleOrderCode,
        packageCode: candidate.packageCode,
        trackingNumber: candidate.trackingNumber,
        manifestCode: candidate.manifestCode,
        courier: candidate.courier,
        itemCount: candidate.itemCount,
        firstItemName: candidate.firstItemName,
        cancellationReason: candidate.cancellationReason,
        cancelledAt: candidate.cancelledAt,
        detectedAt: nowIso(),
        status: missed ? HoldStatus.MISSED : HoldStatus.OPEN,
        missedAt: candidate.dispatchedAt,
      });

      return missed ? HoldOutcome.MISSED : HoldOutcome.CREATED;
    }

    if (existing.status === HoldStatus.OPEN && candidate.dispatchedAt) {
      db.prepare('UPDATE dispatch_holds SET status = ?, missed_at = ? WHERE id = ?').run(
        HoldStatus.MISSED,
        candidate.dispatchedAt,
        String(existing.id)
      );

      return HoldOutcome.MISSED;
    }

    return HoldOutcome.UNCHANGED;
  });
}

export function listOpenHolds(): DispatchHold[] {
  return db
    .prepare('SELECT * FROM dispatch_holds WHERE status = ? ORDER BY manifest_code, cancelled_at')
    .all(HoldStatus.OPEN)
    .map(toHold);
}

/** Open holds, plus anything pulled or missed since `since`. */
export function listHolds(since: string): DispatchHold[] {
  return db
    .prepare(
      `SELECT * FROM dispatch_holds
       WHERE status = :open OR pulled_at >= :since OR missed_at >= :since
       ORDER BY CASE status WHEN :open THEN 0 ELSE 1 END, cancelled_at DESC`
    )
    .all({ open: HoldStatus.OPEN, since })
    .map(toHold);
}

function getHold(id: string): DispatchHold | null {
  const row = db.prepare('SELECT * FROM dispatch_holds WHERE id = ?').get(id);

  return row ? toHold(row) : null;
}

/** Marks an open hold as pulled out. Pulling twice keeps the first record. */
export function pullHold(id: string, by: string, via: PulledVia, at: string): DispatchHold | null {
  db.prepare('UPDATE dispatch_holds SET status = ?, pulled_at = ?, pulled_by = ?, pulled_via = ? WHERE id = ? AND status = ?').run(
    HoldStatus.PULLED,
    at,
    by,
    via,
    id,
    HoldStatus.OPEN
  );

  return getHold(id);
}

function findHoldByCode(normalized: string): DispatchHold | null {
  const row = db
    .prepare(
      `SELECT * FROM dispatch_holds
       WHERE tracking_number = :code COLLATE NOCASE OR package_code = :code COLLATE NOCASE
         OR sale_order_code = :code COLLATE NOCASE
       ORDER BY detected_at DESC LIMIT 1`
    )
    .get({ code: normalized });

  return row ? toHold(row) : null;
}

/**
 * Records one handover scan. A held parcel is stopped and its hold marked as
 * pulled, since the person scanning now has it in hand. Safe to repeat.
 */
export function recordHandoverCheck(check: HandoverCheck): HandoverCheckResult {
  return transaction(() => {
    const stored = db.prepare('SELECT * FROM handover_checks WHERE id = ?').get(check.id);

    if (stored) {
      const hold = stored.hold_id ? getHold(String(stored.hold_id)) : null;
      return { id: check.id, code: String(stored.code), result: stored.result as HandoverResult, hold };
    }

    const found = findHoldByCode(normalizeCode(check.code));

    const result = handoverResultFor(found);

    const hold = result === HandoverResult.STOP && found ? pullHold(found.id, check.checkedBy, PulledVia.HANDOVER_SCAN, check.checkedAt) : found;

    db.prepare(
      `INSERT INTO handover_checks (id, code, result, hold_id, checked_by, checked_at, recorded_at, batch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(check.id, check.code.trim(), result, found?.id ?? null, check.checkedBy, check.checkedAt, nowIso(), check.batchId ?? null);

    return { id: check.id, code: check.code.trim(), result, hold };
  });
}

export function dispatchCounts(since: string): { open: number; pulledToday: number; missedToday: number } {
  const count = (sql: string, ...params: string[]) => Number(db.prepare(sql).get(...params)?.n ?? 0);

  return {
    open: count('SELECT COUNT(*) AS n FROM dispatch_holds WHERE status = ?', HoldStatus.OPEN),
    pulledToday: count('SELECT COUNT(*) AS n FROM dispatch_holds WHERE status = ? AND pulled_at >= ?', HoldStatus.PULLED, since),
    missedToday: count('SELECT COUNT(*) AS n FROM dispatch_holds WHERE status = ? AND missed_at >= ?', HoldStatus.MISSED, since),
  };
}

export interface ExportRange {
  since: string;
  until: string;
}

export interface HandoverCheckExportRow {
  checkedAt: string;
  code: string;
  result: HandoverResult;
  checkedBy: string;
  hold: DispatchHold | null;
}

/** Every handover scan in the range, newest first, with the hold it matched. */
export function listHandoverChecks(range: ExportRange, limit: number): HandoverCheckExportRow[] {
  return db
    .prepare(
      `SELECT checked_at, code, result, checked_by, hold_id FROM handover_checks
       WHERE checked_at >= ? AND checked_at < ? ORDER BY checked_at DESC LIMIT ?`
    )
    .all(range.since, range.until, limit)
    .map(row => ({
      checkedAt: String(row.checked_at),
      code: String(row.code),
      result: row.result as HandoverResult,
      checkedBy: String(row.checked_by),
      hold: row.hold_id ? getHold(String(row.hold_id)) : null,
    }));
}

/** Holds raised, pulled or missed in the range, plus every one still open. */
export function listHoldsForExport(range: ExportRange): DispatchHold[] {
  return db
    .prepare(
      `SELECT * FROM dispatch_holds
       WHERE status = :open
          OR (detected_at >= :since AND detected_at < :until)
          OR (pulled_at >= :since AND pulled_at < :until)
          OR (missed_at >= :since AND missed_at < :until)
       ORDER BY detected_at DESC`
    )
    .all({ open: HoldStatus.OPEN, since: range.since, until: range.until })
    .map(toHold);
}

/**
 * Takes a handover scan back (scanned by mistake, or not going with this
 * courier). A parcel stopped as cancelled stays pulled out: removing the
 * scan doesn't put a cancelled order back on the truck.
 */
export function removeHandoverCheck(id: string) {
  db.prepare('DELETE FROM handover_checks WHERE id = ?').run(id);
}
