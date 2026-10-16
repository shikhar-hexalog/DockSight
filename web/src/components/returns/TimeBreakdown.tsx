// Every pair of the three warehouse times: inward -> processed -> putaway
// closed, on the chosen clock (working hours or all hours).

import { TIME_LEGS, TIME_LEG_LABEL, type ReturnDetail, timeBreakdown } from '@hexabuild/shared';

import { useClock, useHoursFormatter } from '@/hooks/useClock';
import { cn } from '@/lib/utils';

const MS_PER_HOUR = 60 * 60 * 1000;

export function TimeBreakdown({ detail }: { detail: ReturnDetail }) {
  const { mode, schedule } = useClock();

  const hours = useHoursFormatter();

  const gaps = timeBreakdown(
    { inwardAt: detail.receivedAt, processedAt: detail.processedAt ?? detail.qcAt, putawayAt: detail.inventoryReceivedAt ?? detail.qcAt },
    mode,
    schedule
  );

  return (
    <dl className="grid grid-cols-3 divide-x rounded-lg border">
      {TIME_LEGS.map((leg, index) => (
        <div key={leg} className="flex flex-col gap-1 px-3 py-2.5">
          <dt className="text-[11px] text-muted-foreground">{TIME_LEG_LABEL[leg]}</dt>

          <dd className={cn('font-mono text-[15px] font-semibold tabular-nums', index === TIME_LEGS.length - 1 && 'text-foreground')}>
            {gaps[leg] === null ? <span className="text-sm font-normal text-muted-foreground">not yet</span> : hours(gaps[leg]! / MS_PER_HOUR)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
