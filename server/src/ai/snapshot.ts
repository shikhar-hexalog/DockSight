// The data the AI is allowed to read: a compact JSON picture of the warehouse
// right now. The AI answers only from this, so every number it states can be
// traced back here. No customer names, phones or addresses are included.

import {
  ClockMode,
  type GuardStatus,
  HoldStatus,
  RETURN_TYPE_LABEL,
  ReturnSort,
  SCAN_RESULT_LABEL,
  Stage,
  workingMs,
  workdayHours,
} from '@hexabuild/shared';

import { config } from '../config.ts';

import { HOUR_MS } from '../lib/time.ts';
import { listHolds } from '../repo/dispatchRepo.ts';
import { listReceipts } from '../repo/receivingRepo.ts';
import { getOverview, getTatReport } from '../repo/reportsRepo.ts';
import { listReturns } from '../repo/returnsRepo.ts';

const PENDING_ROWS = 200;

const EXCEPTION_ROWS = 50;

const TAT_DAYS = 7;

const hoursSince = (iso: string | null, now: number) => (iso ? Math.round((now - new Date(iso).getTime()) / HOUR_MS) : null);

const workingHoursSince = (iso: string | null, now: number) =>
  iso ? Math.round((workingMs(iso, new Date(now), config.workSchedule) / HOUR_MS) * 10) / 10 : null;

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const clockTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

function scheduleText(): string {
  const s = config.workSchedule;

  const holidays = s.holidays.length > 0 ? `; holidays ${s.holidays.join(', ')}` : '';

  return `${clockTime(s.startMinutes)}-${clockTime(s.endMinutes)}, ${s.days.map(d => WEEKDAY_NAMES[d]).join(', ')}${holidays}`;
}

const localTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : null;

function startOfToday(): string {
  const start = new Date();

  start.setHours(0, 0, 0, 0);

  return start.toISOString();
}

export function buildSnapshot(guard: GuardStatus) {
  const now = Date.now();

  // Ages and TAT are on the working-hours clock: time nobody was on shift doesn't count.
  const overview = getOverview(guard, ClockMode.WORKING);

  const today = new Date();

  const pad = (n: number) => String(n).padStart(2, '0');

  const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const tat = getTatReport({
    clock: ClockMode.WORKING,
    from: day(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (TAT_DAYS - 1))),
    to: day(today),
  });

  const pending = listReturns({ stage: Stage.RECEIVED, sort: ReturnSort.STAGE_AGE, limit: PENDING_ROWS, offset: 0 });

  const exceptions = listReceipts({ exceptionsOnly: true, openOnly: true, limit: EXCEPTION_ROWS });

  const holds = listHolds(startOfToday());

  return {
    generatedAt: localTime(new Date(now).toISOString()),
    definitions: {
      expected: 'Uniware expects the return; it has not reached the warehouse',
      pending: 'Reached the warehouse (dock scan, or courier marked delivered) but not yet processed in Uniware',
      processed: 'Processed in Uniware, back in inventory',
      workingHours: `The warehouse works ${scheduleText()} (${workdayHours(config.workSchedule)}h a day). Waiting and TAT figures are in working hours unless a field says otherwise; a parcel arriving after closing starts counting next working morning.`,
      tatHours: 'Working hours from reaching the warehouse to processed in Uniware',
      setAside: 'Scanned parcels that matched no expected return, or whose return was cancelled',
      dispatchHolds: 'Orders cancelled after their parcel was manifested; must be pulled out before courier handover',
      DTO: 'Customer return (Uniware calls it CIR)',
    },
    today: {
      expected: overview.expected,
      receivedToday: overview.receivedToday,
      processedToday: overview.processedToday,
      pendingNow: overview.pending,
      pendingCarriedOverFromBeforeToday: overview.carriedOver,
      pendingByAge: overview.pendingAges,
      pendingByCourier: overview.pendingByCourier,
      setAsideOpen: overview.exceptionsOpen,
      medianTatTodayHours: overview.tatTodayMedianHours,
      dispatch: {
        toPullNow: overview.dispatch.open,
        pulledToday: overview.dispatch.pulledToday,
        handedOverAnywayToday: overview.dispatch.missedToday,
      },
    },
    lastSevenDays: tat.days.map(d => ({
      day: d.day,
      received: d.received.total,
      processed: d.processed.total,
      medianTatHours: d.medianHours,
      p90TatHours: d.p90Hours,
    })),
    tatByCourier: tat.byCourier,
    pendingReturns: pending.data.map(r => ({
      awb: r.trackingNumber,
      returnCode: r.sourceCode,
      type: RETURN_TYPE_LABEL[r.type],
      courier: r.courier,
      arrived: localTime(r.receivedAt),
      arrivedVia: r.receivedSource,
      workingHoursPending: workingHoursSince(r.receivedAt, now),
      calendarHoursPending: hoursSince(r.receivedAt, now),
      uniwareStatus: r.sourceStatus,
      item: r.firstItemName,
      items: r.itemCount,
    })),
    setAside: exceptions.map(e => ({
      code: e.code,
      problem: SCAN_RESULT_LABEL[e.result],
      returnCode: e.sourceCode,
      saleOrder: e.saleOrderCode,
      scannedAt: localTime(e.scannedAt),
      scannedBy: e.scannedBy,
    })),
    dispatchHolds: holds.map(h => ({
      awb: h.trackingNumber,
      saleOrder: h.saleOrderCode,
      manifest: h.manifestCode,
      courier: h.courier,
      status: h.status === HoldStatus.OPEN ? 'pull out now' : h.status.toLowerCase(),
      cancelledAt: localTime(h.cancelledAt),
      reason: h.cancellationReason,
    })),
  };
}

export type Snapshot = ReturnType<typeof buildSnapshot>;
