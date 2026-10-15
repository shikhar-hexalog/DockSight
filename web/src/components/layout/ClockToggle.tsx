import { Clock } from 'lucide-react';

import { CLOCK_MODE_LABEL, ClockMode } from '@hexabuild/shared';

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useClock } from '@/hooks/useClock';

const CLOCK_MODES = [ClockMode.WORKING, ClockMode.ALL];

const pad = (n: number) => String(n).padStart(2, '0');

const timeOf = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** Switches every waiting time and late flag between working hours and all hours. */
export function ClockToggle() {
  const { mode, setMode, schedule } = useClock();

  return (
    <div className="flex items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Clock className="size-3.5 text-muted-foreground" />
        </TooltipTrigger>

        <TooltipContent className="max-w-xs">
          Working hours counts only {timeOf(schedule.startMinutes)}–{timeOf(schedule.endMinutes)} on working days, so a parcel
          arriving after closing starts waiting the next morning. "wd" = one working day.
        </TooltipContent>
      </Tooltip>

      <ToggleGroup type="single" size="sm" variant="outline" value={mode} onValueChange={value => value && setMode(value as ClockMode)}>
        {CLOCK_MODES.map(clock => (
          <ToggleGroupItem key={clock} value={clock} className="px-3 text-xs">
            {CLOCK_MODE_LABEL[clock]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
