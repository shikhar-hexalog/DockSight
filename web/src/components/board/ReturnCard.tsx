import { ReceivedSource, RETURN_TYPE_LABEL, type ReturnSummary, Stage } from '@hexabuild/shared';

import { Mono } from '@/components/common/Mono';
import { AgeInStage } from '@/components/returns/AgeInStage';

/** On a pending row: scanned at our desk, or listed in the receiving sheet. */
function ArrivalSource({ summary }: { summary: ReturnSummary }) {
  if (summary.stage !== Stage.RECEIVED) {
    return null;
  }

  const text = summary.receivedSource === ReceivedSource.DOCK ? `Scanned${summary.dockReceivedBy ? ` by ${summary.dockReceivedBy}` : ''}` : 'Receiving sheet';

  return <span className="truncate text-[12.5px] text-muted-foreground">{text}</span>;
}

interface ReturnCardProps {
  summary: ReturnSummary;
  onOpen: (id: string) => void;
}

/** One return as a ledger row: code and age, item, then type · courier · reason. */
export function ReturnCard({ summary, onOpen }: ReturnCardProps) {
  const reason = summary.rtoReason ?? summary.firstReason;

  const meta = [RETURN_TYPE_LABEL[summary.type], summary.courier ?? 'Unknown courier', reason ?? 'No reason'].join(' · ');

  return (
    <button
      type="button"
      onClick={() => onOpen(summary.id)}
      className="flex w-full flex-col border-b py-2.5 text-left transition-colors hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline-none"
    >
      <span className="flex items-baseline justify-between gap-2">
        <Mono className="truncate text-[12px] text-ink">{summary.sourceCode}</Mono>

        <AgeInStage stage={summary.stage} since={summary.stageChangedAt} className="text-[12px]" />
      </span>

      <span className="mt-0.5 truncate text-[13.5px]">
        {summary.firstItemName ?? 'Unnamed item'}
        {summary.itemCount > 1 && <span className="text-muted-foreground"> +{summary.itemCount - 1}</span>}
      </span>

      <span className="truncate text-[12.5px] text-muted-foreground">{meta}</span>

      <ArrivalSource summary={summary} />
    </button>
  );
}
