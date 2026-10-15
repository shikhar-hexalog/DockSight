// Loads Uniware's "Courier Returns" export (RTO) into the database, for when
// the API isn't available. Same records and upsert as the live sync, so a
// re-import of a newer export updates rows in place, and stages only move forward.
//
// How the export's columns become our stages:
//   putaway COMPLETE -> Processed, at the putaway date
//   anything else    -> Expected
// "Received at our dock" only comes from our own desk scans and receiving
// sheets, never from Uniware.

import { ReturnType, Stage } from '@hexabuild/shared';

import type { UniwareAccount } from '../config.ts';
import { toIso } from '../lib/time.ts';
import { UpsertOutcome, upsertReturn } from '../repo/returnsRepo.ts';
import { type ReturnRecord, hashRecord } from '../uniware/mapper.ts';
import { csvRecords } from '@hexabuild/shared';

export const COURIER_RETURN_COLUMNS = {
  SALE_ORDER: 'Sale Order No',
  PACKAGE_CODE: 'Shipping Package Code',
  PACKAGE_STATUS: 'Shipping Package Status',
  PROVIDER: 'Shipping Provider',
  COURIER: 'Shipping Courier',
  AWB: 'AWB No',
  RETURN_DELIVERY_DATE: 'Return Delivery Date',
  RTO_REASON: 'RTO Reason',
  CREATED: 'Created',
  MANIFEST_ADDED: 'Return Manifest Added',
  PUTAWAY_NO: 'Putaway No',
  PUTAWAY_STATUS: 'Putaway Status',
  PUTAWAY_DATE: 'Putaway Date',
} as const;

const REQUIRED_COLUMNS = Object.values(COURIER_RETURN_COLUMNS);

const PutawayStatus = {
  COMPLETE: 'COMPLETE',
} as const;

const C = COURIER_RETURN_COLUMNS;

const orNull = (value: string | undefined) => value?.trim() || null;

const earliest = (...dates: (string | null)[]) => dates.filter((d): d is string => d !== null).sort()[0] ?? null;

export function isCourierReturnsExport(header: string[]): boolean {
  return REQUIRED_COLUMNS.every(column => header.includes(column));
}

export function toCourierReturnRecord(row: Record<string, string>): ReturnRecord | null {
  const code = orNull(row[C.PACKAGE_CODE]);

  if (!code) {
    return null;
  }

  const manifestAddedAt = toIso(orNull(row[C.MANIFEST_ADDED]));

  const receivedAt = earliest(toIso(orNull(row[C.RETURN_DELIVERY_DATE])), manifestAddedAt);

  const putawayDone = row[C.PUTAWAY_STATUS]?.trim().toUpperCase() === PutawayStatus.COMPLETE;

  const processedAt = putawayDone ? toIso(orNull(row[C.PUTAWAY_DATE])) ?? manifestAddedAt : null;

  const stage = processedAt ? Stage.PROCESSED : Stage.EXPECTED;

  const stageReachedAt = processedAt;

  const record: Omit<ReturnRecord, 'sourceHash'> = {
    sourceCode: code,
    type: ReturnType.RTO,
    sourceStatus: orNull(row[C.PACKAGE_STATUS]),
    saleOrderCode: orNull(row[C.SALE_ORDER]),
    shipmentCode: code,
    reversePickupCode: null,
    courier: orNull(row[C.COURIER]) ?? orNull(row[C.PROVIDER]),
    trackingNumber: orNull(row[C.AWB]),
    rtoCourier: null,
    rtoTrackingNumber: null,
    rtoReason: orNull(row[C.RTO_REASON]),
    putawayCode: orNull(row[C.PUTAWAY_NO]),
    sourceCreatedAt: toIso(orNull(row[C.CREATED])),
    deliveredAt: receivedAt,
    inventoryReceivedAt: null,
    completedAt: processedAt,
    processedAt,
    stage,
    stageReachedAt,
    // The export has no item lines.
    items: [],
  };

  return { ...record, sourceHash: hashRecord(record) };
}

export interface ImportResult {
  rows: number;
  skipped: number;
  outcomes: Record<UpsertOutcome, number>;
  stages: Record<Stage, number>;
}

export function importCourierReturns(account: UniwareAccount, text: string): ImportResult {
  const { header, records } = csvRecords(text);

  if (!isCourierReturnsExport(header)) {
    const missing = REQUIRED_COLUMNS.filter(column => !header.includes(column));
    throw new Error(`Not a "Courier Returns" export. Missing columns: ${missing.join(', ')}`);
  }

  const result: ImportResult = {
    rows: records.length,
    skipped: 0,
    outcomes: Object.fromEntries(Object.values(UpsertOutcome).map(o => [o, 0])) as Record<UpsertOutcome, number>,
    stages: Object.fromEntries(Object.values(Stage).map(s => [s, 0])) as Record<Stage, number>,
  };

  for (const row of records) {
    const record = toCourierReturnRecord(row);

    if (!record) {
      result.skipped++;
      continue;
    }

    result.outcomes[upsertReturn(account, record)]++;
    result.stages[record.stage]++;
  }

  return result;
}
