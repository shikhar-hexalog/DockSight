const MINUTE_MS = 60_000;

const HOUR_MS = 60 * MINUTE_MS;

const DAY_MS = 24 * HOUR_MS;

export function hoursSince(iso: string, now = Date.now()): number {
  return (now - new Date(iso).getTime()) / HOUR_MS;
}

/** 45m · 6h · 2d 4h */
export function formatDuration(ms: number): string {
  const abs = Math.max(0, ms);

  if (abs < HOUR_MS) {
    return `${Math.max(1, Math.round(abs / MINUTE_MS))}m`;
  }

  if (abs < DAY_MS) {
    return `${Math.round(abs / HOUR_MS)}h`;
  }

  const days = Math.floor(abs / DAY_MS);

  const hours = Math.round((abs - days * DAY_MS) / HOUR_MS);

  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}

/** For short operations: 320ms · 4.2s · 2m */
export function formatElapsed(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  if (ms < MINUTE_MS) {
    return `${(ms / 1000).toFixed(1)}s`;
  }

  return formatDuration(ms);
}

export function formatAge(iso: string, now = Date.now()): string {
  return formatDuration(now - new Date(iso).getTime());
}

export function formatRelative(iso: string | null, now = Date.now()): string {
  if (!iso) {
    return 'never';
  }

  const ms = now - new Date(iso).getTime();

  if (ms < 0) {
    return `in ${formatDuration(-ms)}`;
  }

  if (ms < MINUTE_MS) {
    return 'just now';
  }

  return `${formatDuration(ms)} ago`;
}

const dateTimeFormat = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const dateFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });

export function formatDateTime(iso: string | null): string {
  return iso ? dateTimeFormat.format(new Date(iso)) : '—';
}

export function formatDate(iso: string | null): string {
  return iso ? dateFormat.format(new Date(iso)) : '—';
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat('en-IN').format(n);
}

/**
 * A duration on the working-hours clock: under a working day it reads like
 * "5h 20m"; beyond, in working days ("wd") of the schedule's length.
 */
export function formatWorkingDuration(ms: number, workdayHours: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / MINUTE_MS));

  const dayMinutes = workdayHours * 60;

  if (totalMinutes < 60) {
    return `${Math.max(1, totalMinutes)}m`;
  }

  if (totalMinutes < dayMinutes) {
    const minutes = totalMinutes % 60;
    return minutes === 0 ? `${Math.floor(totalMinutes / 60)}h` : `${Math.floor(totalMinutes / 60)}h ${minutes}m`;
  }

  const days = Math.floor(totalMinutes / dayMinutes);

  const hours = Math.round((totalMinutes - days * dayMinutes) / 60);

  return hours === 0 ? `${days}wd` : `${days}wd ${hours}h`;
}
