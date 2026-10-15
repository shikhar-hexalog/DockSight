// The three gaps in a return's life at the warehouse, every pair of:
//   inward (reached our dock) -> processed in Uniware -> putaway closed
// Processed = Uniware's return completed date; putaway closed = Uniware's
// inventory received date (the stock is back), which comes after it.

import { type ClockMode, type WorkSchedule, elapsedMs } from './workingTime.ts';

export const TimeLeg = {
  INWARD_TO_PROCESSED: 'inwardToProcessed',
  PROCESSED_TO_PUTAWAY: 'processedToPutaway',
  INWARD_TO_PUTAWAY: 'inwardToPutaway',
} as const;

export type TimeLeg = (typeof TimeLeg)[keyof typeof TimeLeg];

export const TIME_LEGS: TimeLeg[] = [TimeLeg.INWARD_TO_PROCESSED, TimeLeg.PROCESSED_TO_PUTAWAY, TimeLeg.INWARD_TO_PUTAWAY];

export const TIME_LEG_LABEL: Record<TimeLeg, string> = {
  [TimeLeg.INWARD_TO_PROCESSED]: 'Inward → processed',
  [TimeLeg.PROCESSED_TO_PUTAWAY]: 'Processed → putaway',
  [TimeLeg.INWARD_TO_PUTAWAY]: 'Inward → putaway (total)',
};

export interface LifeDates {
  inwardAt: string | null;
  processedAt: string | null;
  putawayAt: string | null;
}

/** Each gap in milliseconds on the given clock, or null when a date is missing or out of order. */
export function timeBreakdown(dates: LifeDates, clock: ClockMode, schedule: WorkSchedule): Record<TimeLeg, number | null> {
  const gap = (from: string | null, to: string | null) => (from && to && to >= from ? elapsedMs(from, to, clock, schedule) : null);

  return {
    [TimeLeg.INWARD_TO_PROCESSED]: gap(dates.inwardAt, dates.processedAt),
    [TimeLeg.PROCESSED_TO_PUTAWAY]: gap(dates.processedAt, dates.putawayAt),
    [TimeLeg.INWARD_TO_PUTAWAY]: gap(dates.inwardAt, dates.putawayAt),
  };
}
