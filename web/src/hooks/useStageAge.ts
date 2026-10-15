import { type Stage, isLate, stageElapsedMs, stageLimitHours, usesWorkingClock, workdayHours } from '@hexabuild/shared';

import { formatDuration, formatWorkingDuration } from '@/lib/format';

import { useClock } from './useClock';

/** How long a return has been in its stage, and whether it's late, on the chosen clock. */
export function useStageAge(stage: Stage, since: string) {
  const { mode, schedule } = useClock();

  const now = Date.now();

  const ms = stageElapsedMs(stage, since, now, mode, schedule);

  const working = usesWorkingClock(stage, mode);

  return {
    ms,
    working,
    label: working ? formatWorkingDuration(ms, workdayHours(schedule)) : formatDuration(ms),
    late: isLate(stage, since, now, mode, schedule),
    limitHours: stageLimitHours(stage, mode, schedule),
  };
}
