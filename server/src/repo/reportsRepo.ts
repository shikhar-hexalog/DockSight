// Numbers for the overview and the TAT report.
//
// "Received" = reached the warehouse: our dock scan, else the courier's
// delivery date. "Processed" = done in Uniware. "Pending" = received but not
// yet processed: the gap this app exists to make visible.
//
// Waiting time and TAT can be measured on two clocks: all hours, or only the
// warehouse's working hours (config.workSchedule). Days are local (IST).

import {
  type AgeBucket,
  BATCH_UNSIGNED_WARN_HOURS,
  BatchKind,
  ClockMode,
  type DispatchDay,
  type DispatchReportResponse,
  HandoverResult,
  HoldStatus,
  type CourierPending,
  type GuardStatus,
  type OverviewResponse,
  RETURN_TYPES,
  type ReturnType,
  Stage,
  TIME_LEGS,
  type LegStats,
  type TatCourier,
  type TimeLeg,
  timeBreakdown,
  type TatDay,
  MOVEMENT_KINDS,
  type MovementKind,
  type MovementDay,
  type MovementsResponse,
  type TatReportResponse,
  type TypeCounts,
  elapsedMs,
  workdayHours,
} from '@hexabuild/shared';

import { config } from '../config.ts';
import { db } from '../db/index.ts';
import { DAY_MS, HOUR_MS } from '../lib/time.ts';
import { batchCounts } from './batchesRepo.ts';
import { dispatchCounts } from './dispatchRepo.ts';
import { countOpenExceptions } from './receivingRepo.ts';
import { MOVEMENT_DATE_SQL, MOVEMENT_WHERE_SQL } from '../lib/movements.ts';
import { scopeSql, startOfLocalDay } from '../lib/scope.ts';
import { RECEIVED_AT_SQL } from './returnsRepo.ts';

type Row = Record<string, unknown>;

const COURIER_SQL = "COALESCE(r.rto_courier, r.courier, 'Unknown courier')";

const PENDING_COURIERS_SHOWN = 6;

interface Bucket {
  label: string;
  maxHours: number;
}

function ageBuckets(clock: ClockMode): Bucket[] {
  if (clock === ClockMode.WORKING) {
    const day = workdayHours(config.workSchedule);

    return [
      { label: 'Under 4 working hours', maxHours: 4 },
      { label: 'Within 1 working day', maxHours: day },
      { label: '1–2 working days', maxHours: 2 * day },
      { label: 'Over 2 working days', maxHours: Infinity },
    ];
  }

  return [
    { label: 'Under 4 hours', maxHours: 4 },
    { label: '4–24 hours', maxHours: 24 },
    { label: '1–2 days', maxHours: 48 },
    { label: 'Over 2 days', maxHours: Infinity },
  ];
}

const hoursOn = (clock: ClockMode, from: string, to: string | Date) => elapsedMs(from, to, clock, config.workSchedule) / HOUR_MS;

function startOfDay(date: Date): Date {
  const start = new Date(date);

  start.setHours(0, 0, 0, 0);

  return start;
}

/** YYYY-MM-DD in local time. */
function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function typeCounts(rows: Row[]): TypeCounts {
  const counts = { total: 0 } as TypeCounts;

  for (const type of RETURN_TYPES) {
    counts[type] = 0;
  }

  for (const row of rows) {
    counts[row.type as ReturnType] = Number(row.n);
    counts.total += Number(row.n);
  }

  return counts;
}

function countByType(where: string, params: Record<string, string> = {}): TypeCounts {
  return typeCounts(db.prepare(`SELECT r.type, COUNT(*) AS n FROM returns r WHERE ${where} GROUP BY r.type`).all(params));
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) {
    return null;
  }

  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));

  return Math.round(sorted[index] * 10) / 10;
}

/** Received-to-processed hours, on the given clock, for returns processed in [from, to). */
function tatHours(clock: ClockMode, from: string, to: string, courier?: string, client?: string): number[] {
  const courierFilter = courier ? `AND ${COURIER_SQL} = :courier` : '';

  const scoped = scopeSql({ client }, null);

  const rows = db
    .prepare(
      `SELECT ${RECEIVED_AT_SQL} AS received_at, r.processed_at FROM returns r
       WHERE r.processed_at >= :from AND r.processed_at < :to AND ${RECEIVED_AT_SQL} IS NOT NULL ${courierFilter} ${scoped.sql}`
    )
    .all({ from, to, ...(courier ? { courier } : {}), ...scoped.params });

  return rows
    .filter(row => String(row.processed_at) >= String(row.received_at))
    .map(row => hoursOn(clock, String(row.received_at), String(row.processed_at)))
    .sort((a, b) => a - b);
}

function pendingRows(): { courier: string; receivedAt: string | null }[] {
  return db
    .prepare(`SELECT ${COURIER_SQL} AS courier, ${RECEIVED_AT_SQL} AS received_at FROM returns r WHERE r.stage = :stage`)
    .all({ stage: Stage.RECEIVED })
    .map(row => ({
      courier: String(row.courier),
      receivedAt: row.received_at ? String(row.received_at) : null,
    }));
}

function pendingAges(clock: ClockMode, now: Date): AgeBucket[] {
  const buckets = ageBuckets(clock);

  const counts = buckets.map(bucket => ({ label: bucket.label, count: 0 }));

  for (const row of pendingRows()) {
    const hours = row.receivedAt ? hoursOn(clock, row.receivedAt, now) : 0;

    counts[buckets.findIndex(bucket => hours < bucket.maxHours)].count += 1;
  }

  return counts;
}

function pendingByCourier(clock: ClockMode, now: Date): CourierPending[] {
  const byCourier = new Map<string, { count: number; oldestHours: number }>();

  for (const row of pendingRows()) {
    const hours = row.receivedAt ? hoursOn(clock, row.receivedAt, now) : 0;

    const current = byCourier.get(row.courier) ?? { count: 0, oldestHours: 0 };

    byCourier.set(row.courier, {
      count: current.count + 1,
      oldestHours: Math.max(current.oldestHours, hours),
    });
  }

  return [...byCourier.entries()]
    .map(([courier, value]) => ({
      courier,
      count: value.count,
      oldestHours: Math.round(value.oldestHours),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, PENDING_COURIERS_SHOWN);
}

export function getOverview(guard: GuardStatus, clock: ClockMode = ClockMode.WORKING): OverviewResponse {
  const now = new Date();

  const dayStart = startOfDay(now).toISOString();

  const tomorrow = new Date(new Date(dayStart).getTime() + DAY_MS).toISOString();

  return {
    clock,
    day: dayStart,
    expected: countByType('r.stage = :stage', { stage: Stage.EXPECTED }),
    receivedToday: countByType(`${RECEIVED_AT_SQL} >= :dayStart`, { dayStart }),
    processedToday: countByType('r.processed_at >= :dayStart', { dayStart }),
    pending: countByType('r.stage = :stage', { stage: Stage.RECEIVED }),
    carriedOver: countByType(`r.stage = :stage AND ${RECEIVED_AT_SQL} < :dayStart`, { stage: Stage.RECEIVED, dayStart }).total,
    pendingAges: pendingAges(clock, now),
    pendingByCourier: pendingByCourier(clock, now),
    exceptionsOpen: countOpenExceptions(),
    tatTodayMedianHours: percentile(tatHours(clock, dayStart, tomorrow), 0.5),
    dispatch: { ...dispatchCounts(dayStart), guard },
    batches: batchCounts(new Date(now.getTime() - BATCH_UNSIGNED_WARN_HOURS * HOUR_MS).toISOString()),
  };
}

const MAX_REPORT_DAYS = 92;

const DEFAULT_REPORT_DAYS = 14;

export interface TatReportFilters {
  clock: ClockMode;
  client?: string;
  /** Local days, YYYY-MM-DD, both included. Default: the last 14 days. */
  from?: string;
  to?: string;
}

function reportDays(filters: TatReportFilters): { start: Date; span: number } {
  const today = startOfDay(new Date());

  const end = filters.to ? startOfLocalDay(filters.to) : today;

  const start = filters.from ? startOfLocalDay(filters.from) : new Date(end.getTime() - (DEFAULT_REPORT_DAYS - 1) * DAY_MS);

  // Days counted on the calendar, so a daylight-saving change can't drop one.
  const span = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;

  return { start, span: Math.min(Math.max(span, 1), MAX_REPORT_DAYS) };
}

interface InwardRow {
  type: ReturnType;
  courier: string;
  receivedAt: string;
  processedAt: string | null;
  putawayAt: string | null;
  cancelled: boolean;
}

/** Median / slowest 1 in 10 of each gap, over a set of returns. */
function legStats(rows: InwardRow[], clock: ClockMode): Record<TimeLeg, LegStats> {
  const gaps = rows.map(row =>
    timeBreakdown({ inwardAt: row.receivedAt, processedAt: row.processedAt, putawayAt: row.putawayAt }, clock, config.workSchedule)
  );

  return Object.fromEntries(
    TIME_LEGS.map(leg => {
      const hours = gaps
        .map(g => g[leg])
        .filter((ms): ms is number => ms !== null)
        .map(ms => ms / HOUR_MS)
        .sort((a, b) => a - b);

      return [leg, { medianHours: percentile(hours, 0.5), p90Hours: percentile(hours, 0.9), count: hours.length }];
    })
  ) as Record<TimeLeg, LegStats>;
}

const isPutawayPending = (row: InwardRow) => row.processedAt !== null && row.putawayAt === null;

function emptyCounts(): TypeCounts {
  return typeCounts([]);
}

function bump(counts: TypeCounts, type: ReturnType) {
  counts[type] += 1;
  counts.total += 1;
}

/**
 * Turnaround by inward date: the parcels that reached our dock on each day,
 * followed through to Uniware. Each day's processed / pending / TAT are of
 * that day's arrivals, as of now.
 */
export function getTatReport(filters: TatReportFilters): TatReportResponse {
  const { clock, client } = filters;

  const { start, span } = reportDays(filters);

  const dayStart = (index: number) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);

  const rangeStart = dayStart(0).toISOString();

  const rangeEnd = dayStart(span).toISOString();

  const scoped = scopeSql({ client }, null);

  const rows: InwardRow[] = db
    .prepare(
      `SELECT r.type, ${COURIER_SQL} AS courier, ${RECEIVED_AT_SQL} AS received_at, r.processed_at, r.inventory_received_at, r.stage
       FROM returns r WHERE ${RECEIVED_AT_SQL} >= :from AND ${RECEIVED_AT_SQL} < :to ${scoped.sql}`
    )
    .all({ from: rangeStart, to: rangeEnd, ...scoped.params })
    .map(row => ({
      type: row.type as ReturnType,
      courier: String(row.courier),
      receivedAt: String(row.received_at),
      processedAt: row.processed_at ? String(row.processed_at) : null,
      putawayAt: row.inventory_received_at ? String(row.inventory_received_at) : null,
      cancelled: row.stage === Stage.CANCELLED,
    }));

  const hoursOf = (row: InwardRow) =>
    row.processedAt && row.processedAt >= row.receivedAt ? hoursOn(clock, row.receivedAt, row.processedAt) : null;

  const days: TatDay[] = Array.from({ length: span }, (_, index) => {
    const from = dayStart(index).toISOString();

    const to = dayStart(index + 1).toISOString();

    const cohort = rows.filter(row => row.receivedAt >= from && row.receivedAt < to);

    const day = { received: emptyCounts(), processed: emptyCounts(), pending: emptyCounts() };

    for (const row of cohort) {
      bump(day.received, row.type);

      if (row.processedAt) {
        bump(day.processed, row.type);
      } else if (!row.cancelled) {
        bump(day.pending, row.type);
      }
    }

    const tat = cohort
      .map(hoursOf)
      .filter((h): h is number => h !== null)
      .sort((a, b) => a - b);

    return {
      day: localDay(dayStart(index)),
      ...day,
      putawayPending: cohort.filter(isPutawayPending).length,
      medianHours: percentile(tat, 0.5),
      p90Hours: percentile(tat, 0.9),
      legs: legStats(cohort, clock),
    };
  });

  const couriers = new Map<string, InwardRow[]>();

  for (const row of rows) {
    couriers.set(row.courier, [...(couriers.get(row.courier) ?? []), row]);
  }

  const byCourier: TatCourier[] = [...couriers.entries()]
    .map(([courier, group]) => {
      const tat = group
        .map(hoursOf)
        .filter((h): h is number => h !== null)
        .sort((a, b) => a - b);

      return {
        courier,
        received: group.length,
        processed: group.filter(row => row.processedAt).length,
        pending: group.filter(row => !row.processedAt && !row.cancelled).length,
        putawayPending: group.filter(isPutawayPending).length,
        legs: legStats(group, clock),
        medianHours: percentile(tat, 0.5),
        p90Hours: percentile(tat, 0.9),
      };
    })
    .sort((a, b) => (b.medianHours ?? 0) - (a.medianHours ?? 0));

  const processedWithoutDock = Number(
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM returns r
         WHERE r.processed_at >= :from AND r.processed_at < :to AND ${RECEIVED_AT_SQL} IS NULL ${scoped.sql}`
      )
      .get({ from: rangeStart, to: rangeEnd, ...scoped.params })?.n ?? 0
  );

  return { clock, days, byCourier, processedWithoutDock };
}

/** Dispatch per day: pickups, parcels handed over, cancellations caught and missed. */
export function getDispatchReport(filters: Omit<TatReportFilters, 'clock'>): DispatchReportResponse {
  const { start, span } = reportDays({ ...filters, clock: ClockMode.ALL });

  const dayStart = (index: number) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);

  const count = (sql: string, params: Record<string, string>) => Number(db.prepare(sql).get(params)?.n ?? 0);

  const days: DispatchDay[] = Array.from({ length: span }, (_, index) => {
    const window = { from: dayStart(index).toISOString(), to: dayStart(index + 1).toISOString() };

    const between = (column: string) => `${column} >= :from AND ${column} < :to`;

    return {
      day: localDay(dayStart(index)),
      pickups: count(`SELECT COUNT(*) AS n FROM receiving_batches WHERE kind = '${BatchKind.DISPATCH}' AND ${between('started_at')}`, window),
      handedOver: count(`SELECT COUNT(*) AS n FROM handover_checks WHERE result = '${HandoverResult.CLEAR}' AND ${between('checked_at')}`, window),
      cancellationsCaught: count(`SELECT COUNT(*) AS n FROM dispatch_holds WHERE ${between('detected_at')}`, window),
      pulled: count(`SELECT COUNT(*) AS n FROM dispatch_holds WHERE status = '${HoldStatus.PULLED}' AND ${between('pulled_at')}`, window),
      missed: count(`SELECT COUNT(*) AS n FROM dispatch_holds WHERE status = '${HoldStatus.MISSED}' AND ${between('missed_at')}`, window),
      riderMismatches: count(
        `SELECT COUNT(*) AS n FROM receiving_batches b
         WHERE b.kind = '${BatchKind.DISPATCH}' AND b.courier_count IS NOT NULL AND ${between('b.submitted_at')}
           AND b.courier_count != (SELECT COUNT(*) FROM handover_checks hc WHERE hc.batch_id = b.id AND hc.result = '${HandoverResult.CLEAR}')`,
        window
      ),
    };
  });

  return { days };
}

/**
 * What changed status each day: new returns, arrivals at the dock, processed,
 * cancelled; and the pile at the dock waiting for Uniware when the day ended.
 */
export function getMovements(filters: Omit<TatReportFilters, 'clock'>): MovementsResponse {
  const { start, span } = reportDays({ ...filters, clock: ClockMode.ALL });

  const scoped = scopeSql({ client: filters.client }, null);

  const dayStart = (index: number) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);

  const count = (sql: string, params: Record<string, string>) => Number(db.prepare(sql).get({ ...params, ...scoped.params })?.n ?? 0);

  const days: MovementDay[] = Array.from({ length: span }, (_, index) => {
    const from = dayStart(index).toISOString();

    const to = dayStart(index + 1).toISOString();

    const counts = Object.fromEntries(
      MOVEMENT_KINDS.map(kind => [
        kind,
        count(
          `SELECT COUNT(*) AS n FROM returns r
           WHERE ${MOVEMENT_DATE_SQL[kind]} >= :from AND ${MOVEMENT_DATE_SQL[kind]} < :to ${MOVEMENT_WHERE_SQL[kind]} ${scoped.sql}`,
          { from, to }
        ),
      ])
    ) as Record<MovementKind, number>;

    return {
      day: localDay(dayStart(index)),
      counts,
      processedWithoutArrival: count(
        `SELECT COUNT(*) AS n FROM returns r
         WHERE r.processed_at >= :from AND r.processed_at < :to AND r.dock_received_at IS NULL ${scoped.sql}`,
        { from, to }
      ),
      pendingAtClose: count(
        `SELECT COUNT(*) AS n FROM returns r
         WHERE r.dock_received_at < :to AND (r.processed_at IS NULL OR r.processed_at >= :to)
           AND r.stage != '${Stage.CANCELLED}' ${scoped.sql}`,
        { to }
      ),
    };
  });

  return { days };
}
