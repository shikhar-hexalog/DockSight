import { STAGE_SLA_HOURS, Stage } from './constants.ts';

// Working-hours clock. The warehouse is staffed only part of the day, so a
// parcel that arrives at 17:45 hasn't really "waited 16 hours" by 10:00 the
// next morning; it has waited 15 working minutes. Times are counted in the
// local timezone of whoever runs this (IST on the warehouse machines).

export interface WorkSchedule {
  /** Minutes after midnight the shift starts, e.g. 600 for 10:00. */
  startMinutes: number;
  /** Minutes after midnight the shift ends, e.g. 1080 for 18:00. */
  endMinutes: number;
  /** Working weekdays: 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** Days off as local dates, YYYY-MM-DD. */
  holidays: string[];
}

export const DEFAULT_WORK_SCHEDULE: WorkSchedule = {
  startMinutes: 10 * 60,
  endMinutes: 18 * 60,
  // The warehouse works all seven days.
  days: [0, 1, 2, 3, 4, 5, 6],
  holidays: [],
};

/** Which clock a waiting time is measured on. */
export const ClockMode = {
  WORKING: 'working',
  ALL: 'all',
} as const;

export type ClockMode = (typeof ClockMode)[keyof typeof ClockMode];

export const CLOCK_MODE_LABEL: Record<ClockMode, string> = {
  [ClockMode.WORKING]: 'Working hours',
  [ClockMode.ALL]: 'All hours',
};

const MINUTE_MS = 60_000;

const DAY_MS = 24 * 60 * MINUTE_MS;

// Safety stop for very old records: beyond this, the count is capped.
const MAX_DAYS = 400;

const pad = (n: number) => String(n).padStart(2, '0');

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Length of one working day, in hours (8 for 10:00–18:00). */
export function workdayHours(schedule: WorkSchedule): number {
  return (schedule.endMinutes - schedule.startMinutes) / 60;
}

function isWorkingDay(day: Date, schedule: WorkSchedule): boolean {
  return schedule.days.includes(day.getDay()) && !schedule.holidays.includes(localDateKey(day));
}

/** Milliseconds between `from` and `to` that fall inside working hours. */
export function workingMs(from: Date | string, to: Date | string, schedule: WorkSchedule): number {
  const start = new Date(from).getTime();

  const end = new Date(to).getTime();

  if (!(end > start)) {
    return 0;
  }

  const day = new Date(start);

  day.setHours(0, 0, 0, 0);

  let total = 0;

  for (let i = 0; i < MAX_DAYS && day.getTime() < end; i++) {
    if (isWorkingDay(day, schedule)) {
      const open = day.getTime() + schedule.startMinutes * MINUTE_MS;

      const close = day.getTime() + schedule.endMinutes * MINUTE_MS;

      total += Math.max(0, Math.min(close, end) - Math.max(open, start));
    }

    // setDate keeps local midnight across daylight-saving changes, unlike adding DAY_MS.
    day.setDate(day.getDate() + 1);
  }

  return total;
}

/** Elapsed milliseconds on the chosen clock. */
export function elapsedMs(from: Date | string, to: Date | string, mode: ClockMode, schedule: WorkSchedule): number {
  if (mode === ClockMode.WORKING) {
    return workingMs(from, to, schedule);
  }

  return Math.max(0, new Date(to).getTime() - new Date(from).getTime());
}

export const MS_PER_HOUR = 60 * MINUTE_MS;

export { DAY_MS as MS_PER_DAY };

/**
 * The clock applies to the warehouse's own waiting: returns at the warehouse,
 * not yet processed. Time with the courier (expected) runs around the clock.
 */
function clockFor(stage: Stage, mode: ClockMode): ClockMode {
  return stage === Stage.RECEIVED ? mode : ClockMode.ALL;
}

/** How long a return has been in its stage, on the chosen clock. */
export function stageElapsedMs(stage: Stage, since: string, now: number, mode: ClockMode, schedule: WorkSchedule): number {
  return elapsedMs(since, new Date(now), clockFor(stage, mode), schedule);
}

/** The limit before a return counts as late: one working day on the working clock. */
export function stageLimitHours(stage: Stage, mode: ClockMode, schedule: WorkSchedule): number | null {
  if (clockFor(stage, mode) === ClockMode.WORKING) {
    return workdayHours(schedule);
  }

  return STAGE_SLA_HOURS[stage];
}

export function isLate(stage: Stage, since: string, now: number, mode: ClockMode, schedule: WorkSchedule): boolean {
  const limit = stageLimitHours(stage, mode, schedule);

  return limit !== null && stageElapsedMs(stage, since, now, mode, schedule) > limit * MS_PER_HOUR;
}

/** Whether a stage's waiting time uses the chosen clock (true) or always runs (false). */
export function usesWorkingClock(stage: Stage, mode: ClockMode): boolean {
  return clockFor(stage, mode) === ClockMode.WORKING;
}
