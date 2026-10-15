// Every pair of the three warehouse times: inward -> processed -> putaway
// closed, on the chosen clock (working hours or all hours).

import { TIME_LEGS, TIME_LEG_LABEL, type ReturnDetail, timeBreakdown } from '@hexabuild/shared';

import { useClock, useHoursFormatter } from '@/hooks/useClock';

const MS_PER_HOUR = 60 * 60 * 1000;

export function TimeBreakdown({ detail }: { detail: ReturnDetail }) {
  const { mode, schedule } = useClock();

  const hours = useHoursFormatter();

  const gaps = timeBreakdown({ inwardAt: detail.receivedAt, processedAt: detail.processedAt, putawayAt: detail.inventoryReceivedAt }, mode, schedule);

  return (
    <dl className="grid grid-cols-3 gap-4 pt-2.5">
      {TIME_LEGS.map(leg => (
        <div key={leg} className="flex flex-col gap-1">
          <dt className="text-[12.5px] text-muted-foreground">{TIME_LEG_LABEL[leg]}</dt>

          <dd className="font-display text-[20px] font-semibold tracking-[-0.02em] text-ink tabular-nums">
            {gaps[leg] === null ? <span className="font-sans text-[13.5px] font-normal tracking-normal text-muted-foreground">not yet</span> : hours(gaps[leg]! / MS_PER_HOUR)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
