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
    </button>
  );
}
