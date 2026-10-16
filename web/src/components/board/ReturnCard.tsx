import { ReceivedSource, RETURN_TYPE_LABEL, type ReturnSummary, Stage } from '@hexabuild/shared';

import { Mono } from '@/components/common/Mono';
import { AgeInStage } from '@/components/returns/AgeInStage';

/** On a pending row: scanned at our desk, or listed in the receiving sheet. */
function ArrivalSource({ summary }: { summary: ReturnSummary }) {
  if (summary.stage !== Stage.RECEIVED) {
    return null;
  }

  const text =
    summary.receivedSource === ReceivedSource.DOCK ? `Scanned${summary.dockReceivedBy ? ` by ${summary.dockReceivedBy}` : ''}` : 'Receiving sheet';

  return <span className="truncate text-[12.5px] text-muted-foreground">{text}</span>;
}

/** One kind of inventory, in its colour; nothing when no item is of that kind. */
function InventoryWord({ count, label, className }: { count: number; label: string; className: string }) {
  if (count === 0) {
    return null;
  }

  return <span className={className}>{label}</span>;
}

/** QC'd on our screen; Uniware hasn't closed putaway, so it isn't sent there yet. */
function QcedHere({ show }: { show: boolean }) {
  if (!show) {
    return null;
  }

  return (
    <span title="QC'd here. Recorded in this app; not sent to Uniware yet." className="font-normal text-muted-foreground">
      QC'd here
    </span>
  );
}

/** Once putaway has closed: good or bad inventory, with a count when a return has several. */
function InventoryLine({ summary }: { summary: ReturnSummary }) {
  const { goodItems, badItems, itemCount } = summary;

  if (summary.stage !== Stage.CLOSED || (goodItems === 0 && badItems === 0)) {
    return null;
  }

  const countLabel = (label: string, count: number) => (itemCount > 1 ? `${label} · ${count}` : label);

  return (
    <span className="flex flex-wrap gap-x-3 text-[12.5px] font-medium">
      <InventoryWord count={goodItems} label={countLabel('Good inventory', goodItems)} className="text-ok" />

      <InventoryWord count={badItems} label={countLabel('Bad inventory', badItems)} className="text-overdue" />

      <QcedHere show={summary.qcedHere} />
    </span>
  );
}

function MoreItems({ count }: { count: number }) {
  if (count <= 1) {
    return null;
  }

  return <span className="text-muted-foreground"> +{count - 1}</span>;
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
        <MoreItems count={summary.itemCount} />
      </span>

      <span className="truncate text-[12.5px] text-muted-foreground">{meta}</span>

      <ArrivalSource summary={summary} />

      <InventoryLine summary={summary} />
    </button>
  );
}
