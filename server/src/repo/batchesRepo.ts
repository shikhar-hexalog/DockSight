// Receiving batches (courier handovers) and the condition tags on their scans.

import {
  BatchKind,
  type BatchParcel,
  type BatchStart,
  BatchStatus,
  type BatchSubmitOp,
  type ConditionOp,
  HandoverResult,
  PARCEL_CONDITIONS,
  type ParcelCondition,
  type ReceivingBatch,
} from '@hexabuild/shared';

import { db, transaction } from '../db/index.ts';
import { nowIso } from '../lib/time.ts';
import { saveImage, uploadUrl } from '../lib/uploads.ts';

type Row = Record<string, unknown>;

const str = (value: unknown) => (value === null || value === undefined ? null : String(value));

const FIRST_ITEM_SQL = `(SELECT i.item_name FROM return_items i WHERE i.return_id = r.id ORDER BY i.sale_order_item_code LIMIT 1)`;

function conditionCounts(batchId: string): Record<ParcelCondition, number> {
  const counts = Object.fromEntries(PARCEL_CONDITIONS.map(c => [c, 0])) as Record<ParcelCondition, number>;

  for (const row of db
    .prepare('SELECT condition, COUNT(*) AS n FROM receipts WHERE batch_id = ? AND condition IS NOT NULL GROUP BY condition')
    .all(batchId)) {
    counts[row.condition as ParcelCondition] = Number(row.n);
  }

  return counts;
}

function toBatch(row: Row): ReceivingBatch {
  const id = String(row.id);

  return {
    id,
    batchKind: (str(row.kind) ?? BatchKind.RECEIVE) as BatchKind,
    courier: String(row.courier),
    vehicleNo: str(row.vehicle_no),
    scannedBy: String(row.scanned_by),
    startedAt: String(row.started_at),
    status: row.status as BatchStatus,
    scannedCount: Number(row.scanned_count ?? 0),
    courierCount: row.courier_count === null || row.courier_count === undefined ? null : Number(row.courier_count),
    conditionCounts: conditionCounts(id),
    submittedAt: str(row.submitted_at),
    submittedBy: str(row.submitted_by),
    signedSheetUrl: uploadUrl(str(row.signed_sheet)),
  };
}

// Receiving counts dock scans; dispatch counts parcels that passed the handover check.
const BATCH_COLUMNS = `b.*, CASE b.kind
    WHEN '${BatchKind.DISPATCH}' THEN (SELECT COUNT(*) FROM handover_checks hc WHERE hc.batch_id = b.id AND hc.result = '${HandoverResult.CLEAR}')
    ELSE (SELECT COUNT(*) FROM receipts rc WHERE rc.batch_id = b.id)
  END AS scanned_count`;

export function getBatch(id: string): ReceivingBatch | null {
  const row = db.prepare(`SELECT ${BATCH_COLUMNS} FROM receiving_batches b WHERE b.id = ?`).get(id);

  return row ? toBatch(row) : null;
}

/** Batches started since a time, newest first; open ones always included. */
export function listBatches(since: string): ReceivingBatch[] {
  return db
    .prepare(`SELECT ${BATCH_COLUMNS} FROM receiving_batches b WHERE b.started_at >= ? OR b.status = ? ORDER BY b.started_at DESC`)
    .all(since, BatchStatus.OPEN)
    .map(toBatch);
}

export function batchParcels(batchId: string): BatchParcel[] {
  return db
    .prepare(
      `SELECT rc.id, rc.code, rc.scanned_at, rc.result, rc.condition, rc.condition_note, rc.condition_photo,
         r.source_code, ${FIRST_ITEM_SQL} AS first_item_name
       FROM receipts rc LEFT JOIN returns r ON r.id = rc.return_id
       WHERE rc.batch_id = ? ORDER BY rc.scanned_at`
    )
    .all(batchId)
    .map(row => ({
      scanId: String(row.id),
      code: String(row.code),
      scannedAt: String(row.scanned_at),
      sourceCode: str(row.source_code),
      firstItemName: str(row.first_item_name),
      result: String(row.result),
      condition: str(row.condition) as ParcelCondition | null,
      conditionNote: str(row.condition_note),
      conditionPhotoUrl: uploadUrl(str(row.condition_photo)),
    }));
}

/** Safe to repeat: a batch is stored once. */
export function startBatch(start: BatchStart) {
  db.prepare(
    `INSERT OR IGNORE INTO receiving_batches (id, kind, courier, vehicle_no, scanned_by, started_at, status, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(start.id, start.batchKind, start.courier, start.vehicleNo, start.scannedBy, start.startedAt, BatchStatus.OPEN, nowIso());
}

/** Tags (or untags) one scan. The latest edit wins; a resend of an older one is ignored. */
export function setCondition(op: ConditionOp) {
  transaction(() => {
    const receipt = db.prepare('SELECT condition_updated_at FROM receipts WHERE id = ?').get(op.scanId);

    if (!receipt) {
      throw new Error('Scan not received yet');
    }

    if (receipt.condition_updated_at && String(receipt.condition_updated_at) >= op.updatedAt) {
      return;
    }

    const photo = op.photo ? saveImage(op.photo, 'parcel') : null;

    db.prepare(
      `UPDATE receipts SET condition = ?, condition_note = ?, condition_photo = COALESCE(?, CASE WHEN ? IS NULL THEN NULL ELSE condition_photo END),
         condition_updated_at = ? WHERE id = ?`
    ).run(op.condition, op.note, photo, op.condition, op.updatedAt, op.scanId);
  });
}

/** Locks a batch with the photo of its signed sheet. Safe to repeat. */
export function submitBatch(op: BatchSubmitOp) {
  transaction(() => {
    const batch = db.prepare('SELECT status FROM receiving_batches WHERE id = ?').get(op.batchId);

    if (!batch) {
      throw new Error('Batch not received yet');
    }

    if (batch.status === BatchStatus.SUBMITTED) {
      return;
    }

    const sheet = saveImage(op.signedSheet, 'sheet', { allowPdf: true });

    db.prepare(`UPDATE receiving_batches SET status = ?, courier_count = ?, signed_sheet = ?, submitted_at = ?, submitted_by = ? WHERE id = ?`).run(
      BatchStatus.SUBMITTED,
      op.courierCount,
      sheet,
      op.submittedAt,
      op.submittedBy,
      op.batchId
    );
  });
}

export function batchCounts(overdueBefore: string): { open: number; unsignedOverdue: number; receiveOverdue: number; dispatchOverdue: number } {
  const count = (sql: string, ...params: string[]) => Number(db.prepare(sql).get(...params)?.n ?? 0);

  const overdue = (kind: BatchKind) =>
    count('SELECT COUNT(*) AS n FROM receiving_batches WHERE status = ? AND started_at < ? AND kind = ?', BatchStatus.OPEN, overdueBefore, kind);

  const receiveOverdue = overdue(BatchKind.RECEIVE);

  const dispatchOverdue = overdue(BatchKind.DISPATCH);

  return {
    open: count('SELECT COUNT(*) AS n FROM receiving_batches WHERE status = ?', BatchStatus.OPEN),
    unsignedOverdue: receiveOverdue + dispatchOverdue,
    receiveOverdue,
    dispatchOverdue,
  };
}
