// "What happened, and when" filter for the returns list, kept in the URL so
// a tile like "Received today" can link straight to the returns behind it:
//   /returns?movement=arrived&from=2026-10-15&to=2026-10-15

import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

import { MOVEMENT_KINDS, type MovementKind } from '@hexabuild/shared';

import { dayString } from '@/hooks/useScope';

const PARAM = {
  MOVEMENT: 'movement',
  FROM: 'from',
  TO: 'to',
} as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface MovementFilter {
  movement: MovementKind;
  from: string;
  to: string;
}

/** Link to the returns that had a movement on one day (default: today). */
export function movementLink(movement: MovementKind, day: string = dayString(new Date())): string {
  return `/returns?${new URLSearchParams({ [PARAM.MOVEMENT]: movement, [PARAM.FROM]: day, [PARAM.TO]: day })}`;
}

export function useMovementFilter() {
  const [params, setParams] = useSearchParams();

  const movement = MOVEMENT_KINDS.find(kind => kind === params.get(PARAM.MOVEMENT));

  const from = params.get(PARAM.FROM) ?? '';

  const to = params.get(PARAM.TO) ?? '';

  const filter: MovementFilter | null = movement && DAY.test(from) && DAY.test(to) ? { movement, from, to } : null;

  const clear = useCallback(
    () =>
      setParams(prev => {
        const next = new URLSearchParams(prev);

        Object.values(PARAM).forEach(key => next.delete(key));

        return next;
      }),
    [setParams]
  );

  return { filter, clear };
}
