// The clock waiting times are shown on: working hours (default) or all hours.
// One setting for the whole app, remembered on this computer.

import { useQuery } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';

import { ClockMode, DEFAULT_WORK_SCHEDULE, MS_PER_HOUR, type WorkSchedule, workdayHours } from '@hexabuild/shared';

import { api } from '@/lib/api';
import { formatWorkingDuration } from '@/lib/format';

const STORAGE_KEY = 'hexabuild.clock';

const listeners = new Set<() => void>();

function read(): ClockMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === ClockMode.ALL ? ClockMode.ALL : ClockMode.WORKING;
  } catch {
    return ClockMode.WORKING;
  }
}

let current = read();

function subscribe(listener: () => void) {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function useClock() {
  const mode = useSyncExternalStore(subscribe, () => current);

  const { data } = useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: Infinity });

  const setMode = useCallback((next: ClockMode) => {
    current = next;

    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Blocked storage: the choice lasts until reload.
    }

    listeners.forEach(listener => listener());
  }, []);

  const schedule: WorkSchedule = data?.workSchedule ?? DEFAULT_WORK_SCHEDULE;

  return { mode, setMode, schedule };
}

/**
 * Formats a number of hours for the chosen clock: "5h", "2wd 3h" (working) or
 * "2d" (all hours). Pass a clock for a number measured on a different one.
 */
export function useHoursFormatter() {
  const { mode, schedule } = useClock();

  return useCallback(
    (hours: number | null, clock: ClockMode = mode) => {
      if (hours === null) {
        return '—';
      }

      if (clock === ClockMode.WORKING) {
        return formatWorkingDuration(hours * MS_PER_HOUR, workdayHours(schedule));
      }

      return hours < 48 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`;
    },
    [mode, schedule]
  );
}
