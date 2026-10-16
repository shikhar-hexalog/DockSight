import { ReceivedSource, type ReturnDetail, Stage } from '@hexabuild/shared';

import { useStageAge } from '@/hooks/useStageAge';
import { formatDateTime, formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';

interface TimelineStep {
  label: string;
  at: string | null;
}

function dockLabel(detail: ReturnDetail): string {
  const by = detail.dockReceivedBy ? ` by ${detail.dockReceivedBy}` : '';

  if (detail.receivedSource === ReceivedSource.SHEET) {
    return `Listed in the receiving sheet${by}`;
  }

  return `Scanned at the dock${by}`;
}

function stepsFor(detail: ReturnDetail): TimelineStep[] {
  const steps: TimelineStep[] = [{ label: 'Return created in Uniware', at: detail.sourceCreatedAt }];

  // Only when the courier reported it: then the gap to our dock scan shows a
  // delay on our side, or a delivery the courier claimed that we never saw.
  if (detail.deliveredAt) {
    steps.push({ label: 'Courier says delivered (per Uniware)', at: detail.deliveredAt });
  }

  // Uniware's own dates win; until then, saving our QC counts as processed and put away.
  const processedHere = !detail.processedAt && detail.qcAt;

  const putAwayHere = !detail.inventoryReceivedAt && detail.qcAt;

  return [
    ...steps,
    { label: dockLabel(detail), at: detail.dockReceivedAt },
    { label: processedHere ? 'Processed at our QC (Uniware not updated)' : 'Processed in Uniware', at: detail.processedAt ?? detail.qcAt },
    {
      label: putAwayHere ? 'Put away at our QC (Uniware not updated)' : 'Putaway closed (stock back in inventory)',
      at: detail.inventoryReceivedAt ?? detail.qcAt,
    },
  ];
}

/** The latest step before `index` that has happened. */
function previousDone(steps: TimelineStep[], index: number): TimelineStep | undefined {
  return steps
    .slice(0, index)
    .reverse()
    .find(step => step.at);
}

function StepGap({ steps, index }: { steps: TimelineStep[]; index: number }) {
  const step = steps[index];

  const previous = previousDone(steps, index);

  if (!previous?.at) {
    return null;
  }

  if (step.at) {
    const gap = new Date(step.at).getTime() - new Date(previous.at).getTime();

    return <span className="font-mono text-[12px] text-muted-foreground tabular-nums">+{formatDuration(gap)}</span>;
  }

  // A wait shows on the step right after the last one done, and only for the
  // warehouse's two steps (processing, putaway); a skipped dock scan isn't a wait.
  const lastDone = steps.reduce((last, s, i) => (s.at ? i : last), -1);

  if (index !== lastDone + 1 || index < steps.length - 2) {
    return null;
  }

  return <WaitingFor since={previous.at} what={index === steps.length - 1 ? 'putaway' : 'Uniware'} />;
}

/** Waiting on the next step, on the chosen clock (working hours by default). */
function WaitingFor({ since, what }: { since: string; what: string }) {
  const age = useStageAge(Stage.RECEIVED, since);

  const clock = age.working ? ' working' : '';

  return (
    <span className="font-mono text-[12px] font-medium text-overdue tabular-nums">
      waiting for {what} {age.label}
      {clock}
    </span>
  );
}

function StepTime({ at }: { at: string | null }) {
  if (!at) {
    return <span className="text-[13px] text-muted-foreground">Not yet</span>;
  }

  return <span className="text-[13px] tabular-nums">{formatDateTime(at)}</span>;
}

/** The return's journey, with the time each step took. */
export function ReturnTimeline({ detail }: { detail: ReturnDetail }) {
  const steps = stepsFor(detail);

  return (
    <ol>
      {steps.map((step, index) => (
        <li key={step.label} className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 border-b py-2.5 sm:grid-cols-[minmax(0,1fr)_150px_auto]">
          <span className={cn('text-[13.5px]', step.at ? 'text-foreground' : 'text-muted-foreground')}>{step.label}</span>

          <StepTime at={step.at} />

          <span className="col-span-2 text-right sm:col-span-1">
            <StepGap steps={steps} index={index} />
          </span>
        </li>
      ))}
    </ol>
  );
}
