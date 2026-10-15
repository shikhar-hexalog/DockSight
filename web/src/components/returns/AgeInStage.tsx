import { STAGE_LABEL, type Stage } from '@hexabuild/shared';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useStageAge } from '@/hooks/useStageAge';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

interface AgeInStageProps {
  stage: Stage;
  since: string;
  className?: string;
}

function limitText(limitHours: number | null, working: boolean): string {
  if (limitHours === null) {
    return 'No time limit';
  }

  return working ? `Limit ${limitHours} working hours (one working day)` : `Limit ${limitHours}h`;
}

/** Time spent in the current stage; red once it passes the stage's limit. */
export function AgeInStage({ stage, since, className }: AgeInStageProps) {
  const age = useStageAge(stage, since);

  const clock = age.working ? 'working time' : 'all hours';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('font-mono text-[11px] tabular-nums', age.late ? 'font-medium text-overdue' : 'text-muted-foreground', className)}>
          {age.label}
        </span>
      </TooltipTrigger>

      <TooltipContent side="top">
        In {STAGE_LABEL[stage].toLowerCase()} since {formatDateTime(since)} · {age.label} of {clock} · {limitText(age.limitHours, age.working)}
      </TooltipContent>
    </Tooltip>
  );
}
