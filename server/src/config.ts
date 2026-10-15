import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_WORK_SCHEDULE, UniwareMode, type WorkSchedule } from '@hexabuild/shared';

const ROOT_DIR = fileURLToPath(new URL('../../', import.meta.url));

const ENV_PATH = `${ROOT_DIR}.env`;

if (existsSync(ENV_PATH)) {
  process.loadEnvFile(ENV_PATH);
}

const env = (key: string) => process.env[key]?.trim() || undefined;

/** One Uniware login. A tenant can have several facilities; each account syncs one. */
export interface UniwareAccount {
  key: string;
  tenant: string;
  /** https://<tenant>.unicommerce.com unless UNICOMMERCE_ACCOUNT_<KEY>_BASE_URL is set. */
  baseUrl: string;
  facility: string;
  username: string;
  password: string;
}

const ACCOUNT_FIELDS = ['TENANT', 'FACILITY', 'USERNAME', 'PASSWORD'] as const;

// UNICOMMERCE_ACCOUNT_<KEY>_<FIELD>, the naming the reporting service already uses.
const ACCOUNT_ENV_PATTERN = new RegExp(`^UNICOMMERCE_ACCOUNT_([A-Z0-9]+)_(${ACCOUNT_FIELDS.join('|')})$`);

const MOCK_ACCOUNT: UniwareAccount = {
  key: 'MOCK',
  tenant: 'mock',
  baseUrl: '',
  facility: 'MOCK-WH1',
  username: '',
  password: '',
};

/** Finds every account in .env and reports, by name only, any value that is missing. */
function discoverAccounts() {
  const keys = new Set<string>();

  // Only accounts with at least one value filled in; empty template blocks are ignored.
  for (const name of Object.keys(process.env)) {
    const match = ACCOUNT_ENV_PATTERN.exec(name);

    if (match && env(name)) {
      keys.add(match[1]);
    }
  }

  const ready: UniwareAccount[] = [];

  const incomplete: { key: string; missing: string[] }[] = [];

  for (const key of [...keys].sort()) {
    const value = (field: (typeof ACCOUNT_FIELDS)[number]) => env(`UNICOMMERCE_ACCOUNT_${key}_${field}`);

    const missing = ACCOUNT_FIELDS.filter(field => !value(field)).map(field => `UNICOMMERCE_ACCOUNT_${key}_${field}`);

    if (missing.length > 0) {
      incomplete.push({ key, missing });
      continue;
    }

    ready.push({
      key,
      tenant: value('TENANT')!,
      baseUrl: (env(`UNICOMMERCE_ACCOUNT_${key}_BASE_URL`) ?? `https://${value('TENANT')}.unicommerce.com`).replace(/\/+$/, ''),
      facility: value('FACILITY')!,
      username: value('USERNAME')!,
      password: value('PASSWORD')!,
    });
  }

  return { ready, incomplete };
}

const discovered = discoverAccounts();

function resolveMode(): UniwareMode {
  const requested = env('UNICOMMERCE_MODE');

  if (requested === UniwareMode.MOCK) {
    return UniwareMode.MOCK;
  }

  if (requested === UniwareMode.IMPORT) {
    return UniwareMode.IMPORT;
  }

  if (requested === UniwareMode.LIVE && discovered.ready.length === 0) {
    throw new Error('UNICOMMERCE_MODE=live but no account in .env has all four values');
  }

  return discovered.ready.length > 0 ? UniwareMode.LIVE : UniwareMode.MOCK;
}

const mode = resolveMode();

function accountsFor(current: UniwareMode): UniwareAccount[] {
  if (current === UniwareMode.LIVE) {
    return discovered.ready;
  }

  if (current === UniwareMode.IMPORT) {
    return [];
  }

  return [MOCK_ACCOUNT];
}

/** Imported export files are stored under this account. */
const IMPORT_ACCOUNT: UniwareAccount = {
  key: 'IMPORT',
  tenant: env('UNICOMMERCE_ACCOUNT_A_TENANT') ?? 'uniware',
  baseUrl: '',
  facility: env('IMPORT_FACILITY') ?? env('UNICOMMERCE_ACCOUNT_A_FACILITY') ?? 'UNIWARE',
  username: '',
  password: '',
};

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const HOURS_PATTERN = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Warehouse working hours, for the working-hours clock.
 * WORK_HOURS="10:00-18:00"  WORK_DAYS="Mon,Tue,Wed,Thu,Fri,Sat,Sun"  HOLIDAYS="2026-10-20,2026-11-08"
 */
function resolveWorkSchedule(): WorkSchedule {
  const hours = HOURS_PATTERN.exec(env('WORK_HOURS') ?? '');

  const days = (env('WORK_DAYS') ?? '')
    .split(',')
    .map(day => WEEKDAYS.indexOf(day.trim().slice(0, 3).toUpperCase()))
    .filter(day => day >= 0);

  const holidays = (env('HOLIDAYS') ?? '')
    .split(',')
    .map(day => day.trim())
    .filter(day => DATE_PATTERN.test(day));

  const startMinutes = hours ? Number(hours[1]) * 60 + Number(hours[2]) : DEFAULT_WORK_SCHEDULE.startMinutes;

  const endMinutes = hours ? Number(hours[3]) * 60 + Number(hours[4]) : DEFAULT_WORK_SCHEDULE.endMinutes;

  return {
    startMinutes,
    endMinutes: endMinutes > startMinutes ? endMinutes : DEFAULT_WORK_SCHEDULE.endMinutes,
    days: days.length > 0 ? days : DEFAULT_WORK_SCHEDULE.days,
    holidays,
  };
}

const dbPath = env('DB_PATH') ?? `${ROOT_DIR}data/hexabuild.db`;

mkdirSync(dirname(dbPath), { recursive: true });

export const config = {
  port: Number(env('PORT') ?? 4000),
  workSchedule: resolveWorkSchedule(),
  dbPath,
  uniware: {
    mode,
    accounts: accountsFor(mode),
    importAccount: IMPORT_ACCOUNT,
    incompleteAccounts: discovered.incomplete,
    requestTimeoutMs: 30_000,
    maxRetries: 3,
    // Wait used after a server error, or after a 429 without a Retry-After header.
    errorBackoffMs: 10_000,
    maxConcurrency: Number(env('UNICOMMERCE_MAX_CONCURRENCY') ?? 5),
  },
  guard: {
    // Cancellations are checked often: a parcel can be handed over within minutes.
    intervalMinutes: Number(env('GUARD_INTERVAL_MIN') ?? 2),
  },
  sync: {
    backfillDays: Number(env('BACKFILL_DAYS') ?? 30),
    // Short, so a parcel processed in Uniware leaves the pending list quickly.
    intervalMinutes: Number(env('SYNC_INTERVAL_MIN') ?? 5),
    // Re-read a little before the last cursor so late-landing updates are not missed.
    overlapMinutes: 10,
  },
} as const;
