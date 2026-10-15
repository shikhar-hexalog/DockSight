// The receiving desk: the list it keeps for offline matching, recording
// scans, and the exceptions they raise.

import {
  type DeskManifest,
  type DeskReturn,
  type ParcelCondition,
  EXCEPTION_RESULTS,
  EventType,
  type Receipt,
  type ReceiveScan,
  ReceivedSource,
  type ReturnType,
  ScanResult,
  SheetOutcome,
  type SheetRow,
  Stage,
  classifyScan,
  normalizeCode,
} from '@hexabuild/shared';

import { createHash } from 'node:crypto';

import { db, transaction } from '../db/index.ts';
import { DAY_MS, nowIso } from '../lib/time.ts';
import { uploadUrl } from '../lib/uploads.ts';
import { findReturnIdByCode, insertEvent } from './returnsRepo.ts';

type Row = Record<string, unknown>;

const str = (value: unknown) => (value === null || value === undefined ? null : String(value));

// Recently processed returns stay in the desk's list so a re-scan says
// "already processed" instead of "unexpected".
const PROCESSED_KEEP_DAYS = 3;

const CODE_COLUMNS = ['source_code', 'tracking_number', 'rto_tracking_number', 'shipment_code', 'reverse_pickup_code', 'sale_order_code'];

const FIRST_ITEM_SQL = `(SELECT i.item_name FROM return_items i WHERE i.return_id = r.id ORDER BY i.sale_order_item_code LIMIT 1)`;

const RECEIPT_IN = (results: ScanResult[]) => results.map(result => `'${result}'`).join(', ');

function toDeskReturn(row: Row): DeskReturn {
  const codes = CODE_COLUMNS.map(column => str(row[column])).filter((code): code is string => code !== null);

  return {
    id: String(row.id),
    type: row.type as ReturnType,
    sourceCode: String(row.source_code),
    stage: row.stage as Stage,
    courier: str(row.rto_courier) ?? str(row.courier),
    saleOrderCode: str(row.sale_order_code),
    reversePickupCode: str(row.reverse_pickup_code),
    trackingNumber: str(row.rto_tracking_number) ?? str(row.tracking_number),
    itemCount: Number(row.item_count),
    firstItemName: str(row.first_item_name),
    dockReceivedAt: str(row.dock_received_at),
    dockReceivedBy: str(row.dock_received_by),
    codes: [...new Set(codes)],
  };
}

const DESK_COLUMNS = `
  r.id, r.type, r.source_code, r.stage, r.courier, r.rto_courier, r.dock_received_at, r.dock_received_by,
  ${CODE_COLUMNS.map(c => `r.${c}`).join(', ')},
  (SELECT COUNT(*) FROM return_items i WHERE i.return_id = r.id) AS item_count,
  ${FIRST_ITEM_SQL} AS first_item_name
`;

/** Everything the desk needs to match scans offline. */
export function getDeskManifest(): DeskManifest {
  const processedSince = new Date(Date.now() - PROCESSED_KEEP_DAYS * DAY_MS).toISOString();

  const rows = db
    .prepare(
      `SELECT ${DESK_COLUMNS} FROM returns r
       WHERE r.stage != :closed OR r.processed_at >= :processedSince`
    )
    .all({ closed: Stage.CLOSED, processedSince });

  return { generatedAt: nowIso(), returns: rows.map(toDeskReturn) };
}

export function getDeskReturnById(id: string): DeskReturn | null {
  const row = db.prepare(`SELECT ${DESK_COLUMNS} FROM returns r WHERE r.id = ?`).get(id);

  return row ? toDeskReturn(row) : null;
}

const RECEIPT_COLUMNS = `
  rc.id, rc.code, rc.result, rc.return_id, rc.scanned_by, rc.scanned_at, rc.resolved_at, rc.resolved_by, rc.resolution_note,
  rc.batch_id, rc.condition, rc.condition_note, rc.condition_photo,
  r.type, r.source_code, COALESCE(r.rto_courier, r.courier) AS courier, r.sale_order_code, r.reverse_pickup_code,
  ${FIRST_ITEM_SQL} AS first_item_name
`;

function toReceipt(row: Row): Receipt {
  return {
    id: String(row.id),
    code: String(row.code),
    result: row.result as ScanResult,
    returnId: str(row.return_id),
    type: str(row.type) as ReturnType | null,
    sourceCode: str(row.source_code),
    courier: str(row.courier),
    saleOrderCode: str(row.sale_order_code),
    reversePickupCode: str(row.reverse_pickup_code),
    firstItemName: str(row.first_item_name),
    scannedBy: String(row.scanned_by),
    scannedAt: String(row.scanned_at),
    resolvedAt: str(row.resolved_at),
    resolvedBy: str(row.resolved_by),
    resolutionNote: str(row.resolution_note),
    batchId: str(row.batch_id),
    condition: str(row.condition) as ParcelCondition | null,
    conditionNote: str(row.condition_note),
    conditionPhotoUrl: uploadUrl(str(row.condition_photo)),
  };
}

function getReceipt(id: string): Receipt | null {
  const row = db.prepare(`SELECT ${RECEIPT_COLUMNS} FROM receipts rc LEFT JOIN returns r ON r.id = rc.return_id WHERE rc.id = ?`).get(id);

  return row ? toReceipt(row) : null;
}

/** An unknown code scanned again shouldn't raise a second exception. */
function isRepeatUnknown(normalized: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 FROM receipts WHERE normalized_code = ? AND result = ? AND resolved_at IS NULL').get(normalized, ScanResult.UNEXPECTED)
  );
}

function classify(match: DeskReturn | null, normalized: string): ScanResult {
  const result = classifyScan(match);

  if (result === ScanResult.UNEXPECTED && isRepeatUnknown(normalized)) {
    return ScanResult.ALREADY_RECEIVED;
  }

  return result;
}

/** Marks the return as received at the dock (first scan only). */
function markReceived(match: DeskReturn, scan: ReceiveScan, source: ReceivedSource = ReceivedSource.DOCK) {
  if (match.dockReceivedAt) {
    return;
  }

  db.prepare('UPDATE returns SET dock_received_at = ?, dock_received_by = ?, dock_received_source = ? WHERE id = ?').run(
    scan.scannedAt,
    scan.scannedBy,
    source,
    match.id
  );

  insertEvent({
    returnId: match.id,
    type: EventType.RECEIVED_AT_DOCK,
    actor: scan.scannedBy,
    payload: { code: scan.code },
    occurredAt: scan.scannedAt,
  });

  if (match.stage !== Stage.EXPECTED) {
    return;
  }

  db.prepare('UPDATE returns SET stage = ?, stage_changed_at = ? WHERE id = ?').run(Stage.RECEIVED, scan.scannedAt, match.id);

  insertEvent({
    returnId: match.id,
    type: EventType.STAGE_CHANGED,
    actor: scan.scannedBy,
    payload: { from: Stage.EXPECTED, to: Stage.RECEIVED },
    occurredAt: scan.scannedAt,
  });
}

const MARKS_RECEIVED: ScanResult[] = [ScanResult.MATCHED, ScanResult.CANCELLED_RETURN];

/**
 * Records one scan. Safe to call again with the same scan: the stored
 * result is returned and nothing changes twice.
 */
export function recordScan(scan: ReceiveScan): Receipt {
  return transaction(() => {
    const stored = getReceipt(scan.id);

    if (stored) {
      return stored;
    }

    const normalized = normalizeCode(scan.code);

    const returnId = findReturnIdByCode(normalized);

    const match = returnId ? getDeskReturnById(returnId) : null;

    const result = classify(match, normalized);

    if (match && MARKS_RECEIVED.includes(result)) {
      markReceived(match, scan);
    }

    db.prepare(
      `INSERT INTO receipts (id, code, normalized_code, return_id, result, scanned_by, scanned_at, recorded_at, batch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(scan.id, scan.code.trim(), normalized, match?.id ?? null, result, scan.scannedBy, scan.scannedAt, nowIso(), scan.batchId ?? null);

    return getReceipt(scan.id)!;
  });
}

export interface ReceiptFilters {
  since?: string;
  until?: string;
  exceptionsOnly?: boolean;
  openOnly?: boolean;
  limit: number;
}

export function listReceipts(filters: ReceiptFilters): Receipt[] {
  const where: string[] = [];

  const params: Record<string, string | number> = { limit: filters.limit };

  if (filters.since) {
    where.push('rc.scanned_at >= :since');
    params.since = filters.since;
  }

  if (filters.until) {
    where.push('rc.scanned_at < :until');
    params.until = filters.until;
  }

  if (filters.exceptionsOnly) {
    where.push(`rc.result IN (${RECEIPT_IN(EXCEPTION_RESULTS)})`);
  }

  if (filters.openOnly) {
    where.push('rc.resolved_at IS NULL');
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  return db
    .prepare(
      `SELECT ${RECEIPT_COLUMNS} FROM receipts rc LEFT JOIN returns r ON r.id = rc.return_id
       ${whereSql} ORDER BY rc.scanned_at DESC LIMIT :limit`
    )
    .all(params)
    .map(toReceipt);
}

export function countOpenExceptions(): number {
  return Number(
    db.prepare(`SELECT COUNT(*) AS n FROM receipts WHERE result IN (${RECEIPT_IN(EXCEPTION_RESULTS)}) AND resolved_at IS NULL`).get()?.n ?? 0
  );
}

/** Closes an exception with a note on what was done. Returns null if not found. */
export function resolveReceipt(id: string, resolvedBy: string, note: string): Receipt | null {
  // Resolving twice keeps the first resolution.
  db.prepare('UPDATE receipts SET resolved_at = ?, resolved_by = ?, resolution_note = ? WHERE id = ? AND resolved_at IS NULL').run(
    nowIso(),
    resolvedBy,
    note,
    id
  );

  return getReceipt(id);
}

/** The same sheet row always gets the same id, so importing a file twice changes nothing. */
function sheetRowId(normalized: string, receivedAt: string): string {
  const hex = createHash('sha1').update(`sheet:${normalized}:${receivedAt}`).digest('hex');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const SHEET_SCAN_RESULT: Record<SheetOutcome, ScanResult> = {
  [SheetOutcome.RECEIVED]: ScanResult.MATCHED,
  [SheetOutcome.PROCESSED_TIME_RECORDED]: ScanResult.ALREADY_PROCESSED,
  [SheetOutcome.ALREADY_RECEIVED]: ScanResult.ALREADY_RECEIVED,
  [SheetOutcome.CANCELLED_RETURN]: ScanResult.CANCELLED_RETURN,
  [SheetOutcome.NOT_FOUND]: ScanResult.UNEXPECTED,
  [SheetOutcome.DUPLICATE]: ScanResult.ALREADY_RECEIVED,
};

function processedAtOf(returnId: string): string | null {
  return str(db.prepare('SELECT processed_at FROM returns WHERE id = ?').get(returnId)?.processed_at);
}

/** An earlier sheet time than the one we have is closer to the real arrival. */
function moveDockTimeEarlier(match: DeskReturn, receivedAt: string) {
  if (match.dockReceivedAt && receivedAt < match.dockReceivedAt) {
    db.prepare('UPDATE returns SET dock_received_at = ? WHERE id = ?').run(receivedAt, match.id);
  }
}

function sheetOutcome(match: DeskReturn | null, normalized: string): SheetOutcome {
  if (!match) {
    return isRepeatUnknown(normalized) ? SheetOutcome.ALREADY_RECEIVED : SheetOutcome.NOT_FOUND;
  }

  if (match.dockReceivedAt) {
    return SheetOutcome.ALREADY_RECEIVED;
  }

  if (match.stage === Stage.MANIFESTED || match.stage === Stage.CLOSED) {
    return SheetOutcome.PROCESSED_TIME_RECORDED;
  }

  if (match.stage === Stage.CANCELLED) {
    return SheetOutcome.CANCELLED_RETURN;
  }

  return SheetOutcome.RECEIVED;
}

/**
 * Records one row of the warehouse's receiving sheet as a dock arrival.
 * Like a desk scan, plus: a return Uniware already processed still gets its
 * dock time (if it arrived before processing), so turnaround can be measured.
 */
export function recordSheetRow(row: SheetRow, importedBy: string): SheetOutcome {
  const normalized = normalizeCode(row.awb);

  const id = sheetRowId(normalized, row.receivedAt);

  if (db.prepare('SELECT 1 FROM receipts WHERE id = ?').get(id)) {
    return SheetOutcome.DUPLICATE;
  }

  const returnId = findReturnIdByCode(normalized);

  const match = returnId ? getDeskReturnById(returnId) : null;

  const outcome = sheetOutcome(match, normalized);

  const scan: ReceiveScan = { id, code: row.awb, scannedBy: importedBy, scannedAt: row.receivedAt };

  if (match && outcome === SheetOutcome.ALREADY_RECEIVED) {
    moveDockTimeEarlier(match, row.receivedAt);
  }

  if (match && (outcome === SheetOutcome.RECEIVED || outcome === SheetOutcome.CANCELLED_RETURN)) {
    markReceived(match, scan, ReceivedSource.SHEET);
  }

  if (match && outcome === SheetOutcome.PROCESSED_TIME_RECORDED) {
    const processedAt = processedAtOf(match.id);

    // A sheet time after Uniware processed it would make the turnaround negative.
    if (!processedAt || row.receivedAt <= processedAt) {
      markReceived(match, scan, ReceivedSource.SHEET);
    }
  }

  db.prepare(
    `INSERT INTO receipts (id, code, normalized_code, return_id, result, scanned_by, scanned_at, recorded_at,
       source, vehicle_no, sheet_courier, sheet_type, remarks)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    row.awb.trim(),
    normalized,
    match?.id ?? null,
    SHEET_SCAN_RESULT[outcome],
    importedBy,
    row.receivedAt,
    nowIso(),
    ReceivedSource.SHEET,
    row.vehicleNo,
    row.courier,
    row.type,
    row.remarks
  );

  return outcome;
}

const EXAMPLES_PER_OUTCOME = 5;

class DryRunRollback extends Error {}

/**
 * Imports a whole sheet in one transaction. A dry run does the same work and
 * then rolls it back, so the preview is exactly what the import will do.
 */
export function importSheet(rows: SheetRow[], importedBy: string, dryRun: boolean) {
  const counts = Object.fromEntries(Object.values(SheetOutcome).map(o => [o, 0])) as Record<SheetOutcome, number>;

  const examples: Partial<Record<SheetOutcome, string[]>> = {};

  const run = () => {
    for (const row of rows) {
      const outcome = recordSheetRow(row, importedBy);

      counts[outcome]++;

      const list = (examples[outcome] ??= []);

      if (list.length < EXAMPLES_PER_OUTCOME) {
        list.push(row.awb);
      }
    }

    if (dryRun) {
      throw new DryRunRollback();
    }
  };

  try {
    transaction(run);
  } catch (err) {
    if (!(err instanceof DryRunRollback)) {
      throw err;
    }
  }

  return { dryRun, total: rows.length, counts, examples };
}

// Scans that show the parcel is physically here (a repeat scan counts too).
const ARRIVAL_RESULTS: ScanResult[] = [ScanResult.MATCHED, ScanResult.CANCELLED_RETURN, ScanResult.ALREADY_RECEIVED];

/**
 * Takes a receiving scan back (wrong barcode, or not part of this handover).
 * If it was what marked the return as arrived, the arrival moves to the
 * next scan of the same return, or the return goes back to Expected.
 * Safe to repeat.
 */
export function removeReceipt(scanId: string, removedBy: string, removedAt: string) {
  transaction(() => {
    const receipt = db.prepare('SELECT id, code, return_id FROM receipts WHERE id = ?').get(scanId);

    if (!receipt) {
      return;
    }

    db.prepare('DELETE FROM receipts WHERE id = ?').run(scanId);

    const returnId = str(receipt.return_id);

    if (!returnId) {
      return;
    }

    insertEvent({ returnId, type: EventType.SCAN_REMOVED, actor: removedBy, payload: { code: String(receipt.code) }, occurredAt: removedAt });

    const next = db
      .prepare(
        `SELECT scanned_at, scanned_by, source FROM receipts
         WHERE return_id = ? AND (result IN (${RECEIPT_IN(ARRIVAL_RESULTS)}) OR (source = ? AND result = ?))
         ORDER BY scanned_at LIMIT 1`
      )
      .get(returnId, ReceivedSource.SHEET, ScanResult.ALREADY_PROCESSED);

    if (next) {
      db.prepare('UPDATE returns SET dock_received_at = ?, dock_received_by = ?, dock_received_source = ? WHERE id = ?').run(
        String(next.scanned_at),
        String(next.scanned_by),
        str(next.source) ?? ReceivedSource.DOCK,
        returnId
      );
      return;
    }

    const current = db.prepare('SELECT stage, source_created_at FROM returns WHERE id = ?').get(returnId);

    db.prepare('UPDATE returns SET dock_received_at = NULL, dock_received_by = NULL, dock_received_source = NULL WHERE id = ?').run(returnId);

    if (current?.stage !== Stage.RECEIVED) {
      return;
    }

    db.prepare('UPDATE returns SET stage = ?, stage_changed_at = ? WHERE id = ?').run(Stage.EXPECTED, str(current.source_created_at) ?? removedAt, returnId);

    insertEvent({ returnId, type: EventType.STAGE_CHANGED, actor: removedBy, payload: { from: Stage.RECEIVED, to: Stage.EXPECTED }, occurredAt: removedAt });
  });
}
