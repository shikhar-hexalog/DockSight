import { CLOCK_MODE_LABEL, ClockMode } from '@hexabuild/shared';

import { TextToggle } from '@/components/common/TextToggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useClock } from '@/hooks/useClock';

const OPTIONS = [ClockMode.WORKING, ClockMode.ALL].map(mode => ({ value: mode, label: CLOCK_MODE_LABEL[mode] }));

const pad = (n: number) => String(n).padStart(2, '0');

const timeOf = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** Switches every waiting time and late flag between working hours and all hours. */
export function ClockToggle() {
  const { mode, setMode, schedule } = useClock();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div>
          <TextToggle label="Count time in" options={OPTIONS} value={mode} onChange={setMode} />
        </div>
      </TooltipTrigger>

      <TooltipContent className="max-w-xs">
        Working hours counts only {timeOf(schedule.startMinutes)}–{timeOf(schedule.endMinutes)} on working days, so a parcel
        arriving after closing starts waiting the next morning. "wd" = one working day.
      </TooltipContent>
    </Tooltip>
  );
}
