import { ScanBarcode, FileSpreadsheet } from 'lucide-react';

import { ReceivedSource, type ReturnSummary, Stage } from '@hexabuild/shared';

import { Mono } from '@/components/common/Mono';
import { AgeInStage } from '@/components/returns/AgeInStage';
import { TypeTag } from '@/components/returns/TypeTag';
import { useStageAge } from '@/hooks/useStageAge';
import { cn } from '@/lib/utils';

function MoreItems({ count }: { count: number }) {
  if (count <= 1) {
    return null;
  }

  return <span className="shrink-0 text-xs text-muted-foreground">+{count - 1}</span>;
}

/** On a pending card: scanned at our desk, or listed in the receiving sheet. */
function ArrivalSource({ summary }: { summary: ReturnSummary }) {
  if (summary.stage !== Stage.RECEIVED) {
    return null;
  }

  if (summary.receivedSource === ReceivedSource.DOCK) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <ScanBarcode className="size-3" />
        Scanned{summary.dockReceivedBy ? ` by ${summary.dockReceivedBy}` : ''}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
      <FileSpreadsheet className="size-3" />
      Receiving sheet
    </span>
  );
}

function InventoryChip({ label, className }: { label: string; className: string }) {
  return <span className={cn('rounded-[4px] border px-1.5 py-0.5 text-[10px] font-medium', className)}>{label}</span>;
}

/** Once putaway has closed in Uniware: good or bad inventory, with a count when a return has several. */
function InventoryTags({ summary }: { summary: ReturnSummary }) {
  const { goodItems, badItems, itemCount } = summary;

  if (summary.stage !== Stage.CLOSED || (goodItems === 0 && badItems === 0)) {
    return null;
  }

  const countLabel = (label: string, count: number) => (itemCount > 1 ? `${label} · ${count}` : label);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <GoodChip count={goodItems} label={countLabel('Good inventory', goodItems)} />

      <BadChip count={badItems} label={countLabel('Bad inventory', badItems)} />

      <QcedHereChip show={summary.qcedHere} />
    </div>
  );
}

/** QC'd on our screen; Uniware hasn't closed putaway, so it isn't sent there yet. */
function QcedHereChip({ show }: { show: boolean }) {
  if (!show) {
    return null;
  }

  return (
    <span
      title="QC'd here. Recorded in this app; not sent to Uniware yet."
      className="rounded-[4px] border border-dashed px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
    >
      QC'd here
    </span>
  );
}

function GoodChip({ count, label }: { count: number; label: string }) {
  if (count === 0) {
    return null;
  }

  return <InventoryChip label={label} className="border-ok/30 bg-ok/10 text-ok" />;
}

function BadChip({ count, label }: { count: number; label: string }) {
  if (count === 0) {
    return null;
  }

  return <InventoryChip label={label} className="border-overdue/30 bg-overdue/10 text-overdue" />;
}

interface ReturnCardProps {
  summary: ReturnSummary;
  onOpen: (id: string) => void;
}

export function ReturnCard({ summary, onOpen }: ReturnCardProps) {
  const { late: overdue } = useStageAge(summary.stage, summary.stageChangedAt);

  const reason = summary.rtoReason ?? summary.firstReason;

  return (
    <button
      type="button"
      onClick={() => onOpen(summary.id)}
      className={cn(
        'group relative flex w-full flex-col gap-1.5 rounded-md border bg-card px-3 py-2.5 text-left shadow-xs transition-colors',
        'hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
        overdue && 'border-l-2 border-l-overdue'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <TypeTag type={summary.type} />

          <Mono className="truncate text-[12px] font-medium">{summary.sourceCode}</Mono>
        </div>

        <AgeInStage stage={summary.stage} since={summary.stageChangedAt} />
      </div>

      <div className="flex items-center gap-1.5">
        <span className="truncate text-[13px]">{summary.firstItemName ?? 'Unnamed item'}</span>

        <MoreItems count={summary.itemCount} />
      </div>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="shrink-0">{summary.courier ?? 'Unknown courier'}</span>

        <span className="text-border">·</span>

        <span className="truncate">{reason ?? 'No reason'}</span>
      </div>

      <ArrivalSource summary={summary} />

      <InventoryTags summary={summary} />
    </button>
  );
}
