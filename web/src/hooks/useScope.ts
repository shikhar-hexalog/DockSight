// Client and date-range filters, kept in the URL so they survive reloads and
// carry over between the board and reports.

import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

import type { ScopeFilters } from '@hexabuild/shared';

import { SEARCH_PARAM } from '@/hooks/useSearchQuery';

const PARAM = {
  CLIENT: 'client',
  RANGE: 'range',
  FROM: 'from',
  TO: 'to',
} as const;

/** Preset periods; CUSTOM uses the from/to in the URL. */
export const RangePreset = {
  ALL: 'all',
  TODAY: 'today',
  YESTERDAY: 'yesterday',
  LAST_7: '7d',
  LAST_14: '14d',
  LAST_30: '30d',
  CUSTOM: 'custom',
} as const;

export type RangePreset = (typeof RangePreset)[keyof typeof RangePreset];

export const RANGE_PRESET_LABEL: Record<RangePreset, string> = {
  [RangePreset.ALL]: 'All dates',
  [RangePreset.TODAY]: 'Today',
  [RangePreset.YESTERDAY]: 'Yesterday',
  [RangePreset.LAST_7]: 'Last 7 days',
  [RangePreset.LAST_14]: 'Last 14 days',
  [RangePreset.LAST_30]: 'Last 30 days',
  [RangePreset.CUSTOM]: 'Custom range',
};

const pad = (n: number) => String(n).padStart(2, '0');

/** A local day as YYYY-MM-DD. */
export const dayString = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function daysAgo(days: number): string {
  const date = new Date();

  date.setDate(date.getDate() - days);

  return dayString(date);
}

/** Days (inclusive) for a preset, relative to today. */
const PRESET_DAYS: Record<Exclude<RangePreset, typeof RangePreset.ALL | typeof RangePreset.CUSTOM>, () => { from: string; to: string }> = {
  [RangePreset.TODAY]: () => ({ from: daysAgo(0), to: daysAgo(0) }),
  [RangePreset.YESTERDAY]: () => ({ from: daysAgo(1), to: daysAgo(1) }),
  [RangePreset.LAST_7]: () => ({ from: daysAgo(6), to: daysAgo(0) }),
  [RangePreset.LAST_14]: () => ({ from: daysAgo(13), to: daysAgo(0) }),
  [RangePreset.LAST_30]: () => ({ from: daysAgo(29), to: daysAgo(0) }),
};

function parsePreset(value: string | null, allowed: RangePreset[], fallback: RangePreset): RangePreset {
  return allowed.find(preset => preset === value) ?? fallback;
}

function rangeFor(preset: RangePreset, from: string | null, to: string | null): { from?: string; to?: string } {
  if (preset === RangePreset.ALL) {
    return {};
  }

  if (preset === RangePreset.CUSTOM) {
    return { from: from ?? daysAgo(6), to: to ?? daysAgo(0) };
  }

  return PRESET_DAYS[preset]();
}

export interface ScopeOptions {
  /** Periods offered on this page, in menu order. */
  presets: RangePreset[];
  /** Used when the URL has none (or one this page doesn't offer). */
  defaultPreset: RangePreset;
}

export function useScope({ presets, defaultPreset }: ScopeOptions) {
  const [params, setParams] = useSearchParams();

  const preset = parsePreset(params.get(PARAM.RANGE), presets, defaultPreset);

  const client = params.get(PARAM.CLIENT) ?? undefined;

  // Search (?q=) narrows the board's cards and counts too.
  const q = params.get(SEARCH_PARAM) ?? undefined;

  const scope: ScopeFilters = {
    client,
    q,
    ...rangeFor(preset, params.get(PARAM.FROM), params.get(PARAM.TO)),
  };

  const update = useCallback(
    (changes: Record<string, string | undefined>) => {
      setParams(prev => {
        const next = new URLSearchParams(prev);

        for (const [key, value] of Object.entries(changes)) {
          if (value) {
            next.set(key, value);
          } else {
            next.delete(key);
          }
        }

        return next;
      });
    },
    [setParams]
  );

  const setClient = useCallback((next: string | undefined) => update({ [PARAM.CLIENT]: next }), [update]);

  const setPreset = useCallback(
    (next: RangePreset) => {
      // Switching to custom starts from the period on screen.
      const current = rangeFor(preset, params.get(PARAM.FROM), params.get(PARAM.TO));

      const custom = next === RangePreset.CUSTOM;

      update({
        [PARAM.RANGE]: next,
        [PARAM.FROM]: custom ? (current.from ?? daysAgo(6)) : undefined,
        [PARAM.TO]: custom ? (current.to ?? daysAgo(0)) : undefined,
      });
    },
    [params, preset, update]
  );

  const setCustom = useCallback(
    (from: string, to: string) =>
      update({
        [PARAM.RANGE]: RangePreset.CUSTOM,
        [PARAM.FROM]: from,
        [PARAM.TO]: to,
      }),
    [update]
  );

  return { scope, preset, presets, setClient, setPreset, setCustom };
}

export type Scope = ReturnType<typeof useScope>;

export const BOARD_SCOPE: ScopeOptions = {
  presets: [RangePreset.ALL, RangePreset.TODAY, RangePreset.YESTERDAY, RangePreset.LAST_7, RangePreset.LAST_30, RangePreset.CUSTOM],
  defaultPreset: RangePreset.LAST_7,
};

/** The board over all dates, for links from all-time totals so the counts match. */
export const BOARD_ALL_DATES = `?${PARAM.RANGE}=${RangePreset.ALL}`;

export const REPORT_SCOPE: ScopeOptions = {
  presets: [RangePreset.LAST_7, RangePreset.LAST_14, RangePreset.LAST_30, RangePreset.CUSTOM],
  defaultPreset: RangePreset.LAST_14,
};
