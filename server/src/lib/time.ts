export const MINUTE_MS = 60 * 1000;

export const HOUR_MS = 60 * MINUTE_MS;

export const DAY_MS = 24 * HOUR_MS;

export const nowIso = () => new Date().toISOString();

/** Normalises Uniware's mix of epoch numbers and date strings to ISO, or null. */
export function toIso(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Splits [from, to] into consecutive windows no longer than maxDays. */
export function splitWindow(from: Date, to: Date, maxDays: number): { from: Date; to: Date }[] {
  const windows: { from: Date; to: Date }[] = [];

  let start = from.getTime();

  while (start < to.getTime()) {
    const end = Math.min(start + maxDays * DAY_MS, to.getTime());
    windows.push({ from: new Date(start), to: new Date(end) });
    start = end;
  }

  return windows;
}
