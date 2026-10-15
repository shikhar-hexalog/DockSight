import { Router } from 'express';
import { z } from 'zod';

import {
  ClockMode,
  HANDOVER_RESULT_LABEL,
  HOLD_STATUS_LABEL,
  PARCEL_CONDITION_LABEL,
  ALL_STAGES,
  MOVEMENT_KINDS,
  RETURN_TYPES,
  STAGE_LABEL,
  TIME_LEGS,
  timeBreakdown,
  RETURN_TYPE_LABEL,
  ReturnSort,
  SCAN_RESULT_LABEL,
  type SettingsResponse,
  Stage,
  workingMs,
} from '@hexabuild/shared';

import { config } from '../config.ts';

import { scopeQuery, scopeWindow } from '../lib/scope.ts';
import { HOUR_MS } from '../lib/time.ts';
import { listHandoverChecks, listHoldsForExport } from '../repo/dispatchRepo.ts';
import { listReceipts } from '../repo/receivingRepo.ts';
import { getDispatchReport, getMovements, getOverview, getTatReport } from '../repo/reportsRepo.ts';
import { listReturns } from '../repo/returnsRepo.ts';
import type { DispatchGuard } from '../sync/dispatchGuard.ts';

const clockParam = z.enum([ClockMode.WORKING, ClockMode.ALL]).default(ClockMode.WORKING);

const tatQuery = scopeQuery.extend({ clock: clockParam });

const returnsExportQuery = scopeQuery.extend({
  movement: z.enum(MOVEMENT_KINDS).optional(),
  putawayPending: z.stringbool().optional(),
  processed: z.stringbool().optional(),
  stage: z.enum(ALL_STAGES).optional(),
  type: z.enum(RETURN_TYPES).optional(),
});

const overviewQuery = z.object({ clock: clockParam });

// Defaults to today when no range is given.
const rangeQuery = z.object({
  since: z.iso.datetime().optional(),
  until: z.iso.datetime().optional(),
});

function exportRange(query: unknown): { since: string; until: string } {
  const { since, until } = rangeQuery.parse(query);

  const start = new Date();

  start.setHours(0, 0, 0, 0);

  return {
    since: since ?? start.toISOString(),
    until: until ?? new Date(Date.now() + HOUR_MS).toISOString(),
  };
}

/** "2026-10-08_to_2026-10-14" or "2026-10-14" for the file name. */
function rangeName(range: { since: string; until: string }): string {
  const from = excelTime(range.since)!.slice(0, 10);

  const to = excelTime(new Date(new Date(range.until).getTime() - 1).toISOString())!.slice(0, 10);

  return from === to ? from : `${from}_to_${to}`;
}

const EXPORT_LIMIT = 50_000;

type Cell = string | number | null;

function csvCell(value: Cell): string {
  const text = value === null ? '' : String(value);

  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
}

function sendCsv(res: import('express').Response, filename: string, csv: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  // Byte-order mark so Excel opens it as UTF-8.
  res.send(`\uFEFF${csv}`);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local time as Excel reads it: 2026-10-14 09:42. */
function excelTime(iso: string | null): string | null {
  if (!iso) {
    return null;
  }

  const d = new Date(iso);

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const today = () => excelTime(new Date().toISOString())!.slice(0, 10);

export function reportsRouter(guard: DispatchGuard) {
  const router = Router();

  router.get('/settings', (_req, res) => {
    const body: SettingsResponse = { workSchedule: config.workSchedule };

    res.json(body);
  });

  router.get('/overview', (req, res) => {
    const { clock } = overviewQuery.parse(req.query);

    res.json(getOverview(guard.status(), clock));
  });

  router.get('/reports/tat', (req, res) => {
    res.json(getTatReport(tatQuery.parse(req.query)));
  });

  router.get('/reports/dispatch', (req, res) => {
    res.json(getDispatchReport(scopeQuery.parse(req.query)));
  });

  router.get('/reports/movements', (req, res) => {
    res.json(getMovements(scopeQuery.parse(req.query)));
  });

  // The returns behind one number in the movements report (or any return list).
  router.get('/export/returns.csv', (req, res) => {
    const filters = returnsExportQuery.parse(req.query);

    const { data } = listReturns({
      ...filters,
      sort: ReturnSort.RECENT,
      limit: EXPORT_LIMIT,
      offset: 0,
    });

    const csv = toCsv(
      [
        'Return',
        'Type',
        'Stage',
        'Uniware status',
        'Sale order',
        'AWB',
        'Courier',
        'Item',
        'Items',
        'Created in Uniware',
        'Arrived at dock',
        'Arrived via',
        'Processed in Uniware',
        'Putaway closed',
        'Inward to processed (working h)',
        'Processed to putaway (working h)',
        'Inward to putaway (working h)',
      ],
      data.map(r => [
        r.sourceCode,
        RETURN_TYPE_LABEL[r.type],
        STAGE_LABEL[r.stage],
        r.sourceStatus,
        r.saleOrderCode,
        r.trackingNumber,
        r.courier,
        r.firstItemName,
        r.itemCount,
        excelTime(r.sourceCreatedAt),
        excelTime(r.receivedAt),
        r.receivedSource,
        excelTime(r.processedAt),
        excelTime(r.inventoryReceivedAt),
        ...TIME_LEGS.map(leg => {
          const ms = timeBreakdown(
            { inwardAt: r.receivedAt, processedAt: r.processedAt, putawayAt: r.inventoryReceivedAt },
            ClockMode.WORKING,
            config.workSchedule
          )[leg];

          return ms === null ? null : Math.round((ms / HOUR_MS) * 10) / 10;
        }),
      ])
    );

    const name = filters.movement ? `${filters.movement}-` : '';

    const window = scopeWindow(filters);

    const period = window.from && window.to ? rangeName({ since: window.from, until: window.to }) : today();

    sendCsv(res, `returns-${name}${period}.csv`, csv);
  });

  // Everything received but not yet processed in Uniware, oldest first.
  router.get('/export/pending.csv', (_req, res) => {
    const { data } = listReturns({
      stage: Stage.RECEIVED,
      sort: ReturnSort.STAGE_AGE,
      limit: EXPORT_LIMIT,
      offset: 0,
    });

    const now = Date.now();

    const csv = toCsv(
      [
        'AWB',
        'Return code',
        'Type',
        'Courier',
        'Sale order',
        'Received at',
        'Received via',
        'Hours pending',
        'Working hours pending',
        'Uniware status',
        'Items',
        'First item',
      ],
      data.map(r => [
        r.trackingNumber,
        r.sourceCode,
        RETURN_TYPE_LABEL[r.type],
        r.courier,
        r.saleOrderCode,
        excelTime(r.receivedAt),
        r.receivedSource,
        r.receivedAt ? Math.round((now - new Date(r.receivedAt).getTime()) / HOUR_MS) : null,
        r.receivedAt ? Math.round((workingMs(r.receivedAt, new Date(now), config.workSchedule) / HOUR_MS) * 10) / 10 : null,
        r.sourceStatus,
        r.itemCount,
        r.firstItemName,
      ])
    );

    sendCsv(res, `pending-in-uniware-${today()}.csv`, csv);
  });

  router.get('/export/scans.csv', (req, res) => {
    const range = exportRange(req.query);

    const receipts = listReceipts({
      since: range.since,
      until: range.until,
      limit: EXPORT_LIMIT,
    });

    const csv = toCsv(
      [
        'Scanned at',
        'Scanned code',
        'Result',
        'Return code',
        'Type',
        'Courier',
        'Sale order',
        'Scanned by',
        'Condition',
        'Condition note',
        'Parcel photo',
        'Batch',
        'Resolved at',
        'Resolution',
      ],
      receipts.map(r => [
        excelTime(r.scannedAt),
        r.code,
        SCAN_RESULT_LABEL[r.result],
        r.sourceCode,
        r.type ? RETURN_TYPE_LABEL[r.type] : null,
        r.courier,
        r.saleOrderCode,
        r.scannedBy,
        r.condition ? PARCEL_CONDITION_LABEL[r.condition] : null,
        r.conditionNote,
        r.conditionPhotoUrl,
        r.batchId,
        excelTime(r.resolvedAt),
        r.resolutionNote,
      ])
    );

    sendCsv(res, `received-scans-${rangeName(range)}.csv`, csv);
  });

  router.get('/export/handover.csv', (req, res) => {
    const range = exportRange(req.query);

    const csv = toCsv(
      ['Checked at', 'Scanned code', 'Result', 'Sale order', 'Package', 'Manifest', 'Courier', 'Cancelled at', 'Cancellation reason', 'Checked by'],
      listHandoverChecks(range, EXPORT_LIMIT).map(c => [
        excelTime(c.checkedAt),
        c.code,
        HANDOVER_RESULT_LABEL[c.result],
        c.hold?.saleOrderCode ?? null,
        c.hold?.packageCode ?? null,
        c.hold?.manifestCode ?? null,
        c.hold?.courier ?? null,
        excelTime(c.hold?.cancelledAt ?? null),
        c.hold?.cancellationReason ?? null,
        c.checkedBy,
      ])
    );

    sendCsv(res, `handover-scans-${rangeName(range)}.csv`, csv);
  });

  router.get('/export/holds.csv', (req, res) => {
    const range = exportRange(req.query);

    const csv = toCsv(
      [
        'Status',
        'AWB',
        'Package',
        'Sale order',
        'Manifest',
        'Courier',
        'Items',
        'First item',
        'Cancelled at',
        'Cancellation reason',
        'Detected at',
        'Pulled at',
        'Pulled by',
        'Handed over anyway at',
      ],
      listHoldsForExport(range).map(h => [
        HOLD_STATUS_LABEL[h.status],
        h.trackingNumber,
        h.packageCode,
        h.saleOrderCode,
        h.manifestCode,
        h.courier,
        h.itemCount,
        h.firstItemName,
        excelTime(h.cancelledAt),
        h.cancellationReason,
        excelTime(h.detectedAt),
        excelTime(h.pulledAt),
        h.pulledBy,
        excelTime(h.missedAt),
      ])
    );

    sendCsv(res, `cancellation-holds-${rangeName(range)}.csv`, csv);
  });

  return router;
}
