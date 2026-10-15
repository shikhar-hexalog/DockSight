// Return manifests and QC, recorded in this app only. Nothing here writes to
// Uniware: QC keeps the returns/complete body it would send as a dry run.

import { randomUUID } from 'node:crypto';

import {
  EventType,
  type ManifestParcel,
  ManifestStatus,
  type QcItemRecord,
  QcLookupResult,
  type QcLookupResponse,
  type QcRecord,
  type QcReturn,
  type QcSubmit,
  type QcMatchCheck,
  type ReturnManifest,
  ScanResult,
  type Stage,
  type UniwareQcPayload,
  normalizeCode,
  parcelShelf,
  shelfFor,
} from '@hexabuild/shared';

import { db, transaction } from '../db/index.ts';
import { nowIso } from '../lib/time.ts';
import { saveImage, uploadUrl } from '../lib/uploads.ts';
import { findReturnIdByCode, insertEvent, toItem } from './returnsRepo.ts';

type Row = Record<string, unknown>;

const str = (value: unknown) => (value === null || value === undefined ? null : String(value));

/** Receiving scans that count as this parcel arriving in the handover. */
const MANIFESTED_RESULTS: string[] = [ScanResult.MATCHED, ScanResult.CANCELLED_RETURN];

export class WorkflowError extends Error {}

// ---------------------------------------------------------------- manifests

const MANIFEST_COLUMNS = `m.*, (SELECT COUNT(*) FROM manifest_parcels mp WHERE mp.manifest_id = m.id) AS parcel_count`;

function toManifest(row: Row): ReturnManifest {
  return {
    id: String(row.id),
    courier: String(row.courier),
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
    status: row.status as ManifestStatus,
    closedAt: str(row.closed_at),
    closedBy: str(row.closed_by),
    count: Number(row.parcel_count ?? 0),
  };
}

export function getManifest(id: string): ReturnManifest | null {
  const row = db.prepare(`SELECT ${MANIFEST_COLUMNS} FROM return_manifests m WHERE m.id = ?`).get(id);

  return row ? toManifest(row) : null;
}

/** Open manifests, and closed ones since a time; newest first. */
export function listManifests(since: string): ReturnManifest[] {
  return db
    .prepare(`SELECT ${MANIFEST_COLUMNS} FROM return_manifests m WHERE m.status = ? OR m.created_at >= ? ORDER BY m.created_at DESC`)
    .all(ManifestStatus.OPEN, since)
    .map(toManifest);
}

const PARCEL_SQL = `SELECT mp.return_id, mp.code, mp.added_at, r.source_code, r.sale_order_code, COALESCE(r.rto_courier, r.courier) AS courier,
    (SELECT i.item_name FROM return_items i WHERE i.return_id = r.id ORDER BY i.sale_order_item_code LIMIT 1) AS first_item_name,
    (SELECT COUNT(*) FROM return_items i WHERE i.return_id = r.id) AS item_count,
    EXISTS (SELECT 1 FROM qc_results q WHERE q.return_id = r.id) AS qc_done
  FROM manifest_parcels mp JOIN returns r ON r.id = mp.return_id`;

function toParcel(row: Row): ManifestParcel {
  return {
    returnId: String(row.return_id),
    code: String(row.code),
    sourceCode: String(row.source_code),
    saleOrderCode: str(row.sale_order_code),
    courier: str(row.courier),
    firstItemName: str(row.first_item_name),
    itemCount: Number(row.item_count),
    addedAt: String(row.added_at),
    qcDone: Boolean(row.qc_done),
  };
}

export function manifestParcels(manifestId: string): ManifestParcel[] {
  return db.prepare(`${PARCEL_SQL} WHERE mp.manifest_id = ? ORDER BY mp.added_at DESC`).all(manifestId).map(toParcel);
}

/**
 * Makes the return manifest for a submitted receiving handover: every parcel
 * the batch received, under the batch's courier. Safe to repeat. A return
 * already in another manifest stays there.
 */
export function createManifestFromBatch(batchId: string) {
  const batch = db.prepare('SELECT * FROM receiving_batches WHERE id = ?').get(batchId);

  if (!batch) {
    return;
  }

  const created = db
    .prepare(
      `INSERT OR IGNORE INTO return_manifests (id, courier, created_by, created_at, status, closed_at, closed_by, batch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(batchId, batch.courier, batch.scanned_by, batch.started_at, ManifestStatus.CLOSED, batch.submitted_at, batch.submitted_by, batchId);

  if (created.changes === 0) {
    return;
  }

  const receipts = db
    .prepare(
      `SELECT return_id, normalized_code, scanned_by, scanned_at FROM receipts
       WHERE batch_id = ? AND return_id IS NOT NULL AND result IN (${MANIFESTED_RESULTS.map(() => '?').join(', ')}) ORDER BY scanned_at`
    )
    .all(batchId, ...MANIFESTED_RESULTS);

  const add = db.prepare('INSERT OR IGNORE INTO manifest_parcels (manifest_id, return_id, code, added_by, added_at) VALUES (?, ?, ?, ?, ?)');

  for (const receipt of receipts) {
    const added = add.run(batchId, receipt.return_id, receipt.normalized_code, receipt.scanned_by, receipt.scanned_at);

    if (added.changes > 0) {
      insertEvent({
        returnId: String(receipt.return_id),
        type: EventType.MANIFEST_ADDED,
        actor: String(batch.submitted_by ?? batch.scanned_by),
        payload: { manifestId: batchId, courier: batch.courier },
        occurredAt: String(batch.submitted_at),
      });
    }
  }
}

// ----------------------------------------------------------------------- QC

function qcItems(qcId: string, returnId: string): QcItemRecord[] {
  return db
    .prepare(
      `SELECT qi.sale_order_item_code, qi.grade, qi.reason, i.item_name, i.sku_code
       FROM qc_items qi LEFT JOIN return_items i ON i.return_id = ? AND i.sale_order_item_code = qi.sale_order_item_code
       WHERE qi.qc_id = ? ORDER BY qi.sale_order_item_code`
    )
    .all(returnId, qcId)
    .map(row => ({
      code: String(row.sale_order_item_code),
      grade: row.grade as QcItemRecord['grade'],
      reason: str(row.reason) as QcItemRecord['reason'],
      itemName: str(row.item_name),
      skuCode: str(row.sku_code),
    }));
}

function toQcRecord(row: Row): QcRecord {
  const returnId = String(row.return_id);

  return {
    id: String(row.id),
    returnId,
    qcBy: String(row.qc_by),
    qcAt: String(row.qc_at),
    shelfCode: String(row.shelf_code),
    photoUrl: uploadUrl(str(row.photo)),
    items: qcItems(String(row.id), returnId),
    aiCheck: row.ai_check ? (JSON.parse(String(row.ai_check)) as QcMatchCheck) : null,
    uniwarePayload: JSON.parse(String(row.uniware_payload)) as UniwareQcPayload,
    pushedAt: str(row.pushed_at),
  };
}

function qcOf(returnId: string): QcRecord | null {
  const row = db.prepare('SELECT * FROM qc_results WHERE return_id = ?').get(returnId);

  return row ? toQcRecord(row) : null;
}

function qcReturn(returnId: string): QcReturn | null {
  const row = db
    .prepare(
      `SELECT r.id, r.type, r.stage, r.source_code, r.sale_order_code, COALESCE(r.rto_courier, r.courier) AS courier, r.dock_received_at,
         m.id AS manifest_id, m.courier AS manifest_courier
       FROM returns r LEFT JOIN manifest_parcels mp ON mp.return_id = r.id LEFT JOIN return_manifests m ON m.id = mp.manifest_id
       WHERE r.id = ?`
    )
    .get(returnId);

  if (!row) {
    return null;
  }

  return {
    id: String(row.id),
    type: row.type as QcReturn['type'],
    stage: row.stage as Stage,
    sourceCode: String(row.source_code),
    saleOrderCode: str(row.sale_order_code),
    courier: str(row.courier),
    dockReceivedAt: str(row.dock_received_at),
    manifest: row.manifest_id ? { id: String(row.manifest_id), courier: String(row.manifest_courier) } : null,
    items: db.prepare('SELECT * FROM return_items WHERE return_id = ? ORDER BY sale_order_item_code').all(returnId).map(toItem),
    qc: qcOf(returnId),
  };
}

export function lookupForQc(rawCode: string): QcLookupResponse {
  const code = normalizeCode(rawCode);

  const returnId = findReturnIdByCode(code);

  const found = returnId ? qcReturn(returnId) : null;

  return { result: found ? QcLookupResult.FOUND : QcLookupResult.NOT_FOUND, code, return: found };
}

/** What the AI may see of the expected items: product names and catalogue images only, no customer data. */
export function expectedItemsFor(returnId: string): { code: string; name: string; imageUrl: string | null }[] {
  return db
    .prepare('SELECT sale_order_item_code, item_name, catalog_image_url FROM return_items WHERE return_id = ? ORDER BY sale_order_item_code')
    .all(returnId)
    .map(row => ({ code: String(row.sale_order_item_code), name: str(row.item_name) ?? 'unnamed item', imageUrl: str(row.catalog_image_url) }));
}

export function submitQc(input: QcSubmit): QcRecord {
  return transaction(() => {
    const target = qcReturn(input.returnId);

    if (!target) {
      throw new WorkflowError('Return not found');
    }

    if (target.qc) {
      throw new WorkflowError(`Already QC'd by ${target.qc.qcBy}`);
    }

    if (!target.dockReceivedAt) {
      throw new WorkflowError('This parcel was never received at the dock. Receive it first.');
    }

    if (!target.saleOrderCode) {
      throw new WorkflowError('This return has no sale order code, so Uniware could not take its QC');
    }

    // Uniware wants every item of a return in one call.
    const known = new Set(target.items.map(item => item.saleOrderItemCode));

    const graded = new Set(input.items.map(item => item.code));

    if (known.size === 0 || graded.size !== known.size || [...known].some(code => !graded.has(code))) {
      throw new WorkflowError('Grade every item in the return, once each');
    }

    const payload: UniwareQcPayload = {
      saleOrderCode: target.saleOrderCode,
      saleOrderItems: input.items.map(item => ({
        code: item.code,
        status: item.grade,
        shelfCode: shelfFor(input.shelfCode, item.grade),
        ...(item.reason ? { reason: item.reason } : {}),
      })),
    };

    const shelfCode = parcelShelf(input.shelfCode, input.items.map(item => item.grade));

    const id = randomUUID();

    const qcAt = nowIso();

    const photo = input.photo ? saveImage(input.photo, 'qc') : null;

    db.prepare(
      `INSERT INTO qc_results (id, return_id, qc_by, qc_at, shelf_code, photo, ai_check, uniware_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.returnId,
      input.qcBy,
      qcAt,
      shelfCode,
      photo,
      input.aiCheck ? JSON.stringify(input.aiCheck) : null,
      JSON.stringify(payload)
    );

    const insertItem = db.prepare('INSERT INTO qc_items (qc_id, sale_order_item_code, grade, reason) VALUES (?, ?, ?, ?)');

    for (const item of input.items) {
      insertItem.run(id, item.code, item.grade, item.reason);
    }

    insertEvent({
      returnId: input.returnId,
      type: EventType.QC_DONE,
      actor: input.qcBy,
      payload: { shelfCode, grades: input.items.map(item => item.grade) },
      occurredAt: qcAt,
    });

    return qcOf(input.returnId)!;
  });
}

export function recentQc(since: string, limit: number) {
  return db
    .prepare(
      `SELECT q.*, r.source_code, r.sale_order_code FROM qc_results q JOIN returns r ON r.id = q.return_id
       WHERE q.qc_at >= ? ORDER BY q.qc_at DESC LIMIT ?`
    )
    .all(since, limit)
    .map(row => ({ ...toQcRecord(row), sourceCode: String(row.source_code), saleOrderCode: str(row.sale_order_code) }));
}
