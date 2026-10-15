import { Copy } from 'lucide-react';
import { toast } from 'sonner';

import { RETURN_TYPE_LABEL, SCAN_RESULT_LABEL, ScanResult } from '@hexabuild/shared';

import { Mono } from '@/components/common/Mono';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

import type { DeskScanEntry } from '../localDb';
import { RESULT_STYLE } from '../scanResultStyle';

function ReturnLine({ entry }: { entry: DeskScanEntry }) {
  if (!entry.sourceCode) {
    return null;
  }

  const more = entry.itemCount && entry.itemCount > 1 ? ` +${entry.itemCount - 1} more` : '';

  const parts = [entry.type ? RETURN_TYPE_LABEL[entry.type] : null, entry.sourceCode, entry.courier].filter(Boolean);

  return (
    <p className="text-base">
      <Mono className="text-base font-medium">{parts.join(' · ')}</Mono>
      <span className="opacity-75">
        {' '}
        · {entry.firstItemName ?? 'Item'}
        {more}
      </span>
    </p>
  );
}

function EarlierScan({ entry }: { entry: DeskScanEntry }) {
  if (entry.result !== ScanResult.ALREADY_RECEIVED || !entry.earlierScanAt) {
    return null;
  }

  const by = entry.earlierScanBy ? ` by ${entry.earlierScanBy}` : '';

  return (
    <p className="text-sm opacity-75">
      First scanned {formatDateTime(entry.earlierScanAt)}
      {by}
    </p>
  );
}

function CopyChip({ label, value }: { label: string; value: string | null }) {
  if (!value) {
    return null;
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(value!);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Copy is blocked here; select the text instead.');
    }
  }

  return (
    <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1.5 rounded-sm bg-white px-2 py-1 text-xs text-ink">
      <span className="text-muted-foreground">{label}</span>

      <Mono className="text-xs font-medium">{value}</Mono>

      <Copy className="size-3 text-muted-foreground" />
    </button>
  );
}

/** For a cancelled return: what's needed to recreate the reverse pickup. */
function RecreateDetails({ entry }: { entry: DeskScanEntry }) {
  if (entry.result !== ScanResult.CANCELLED_RETURN) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      <CopyChip label="AWB" value={entry.code} />

      <CopyChip label="Order" value={entry.saleOrderCode} />

      <CopyChip label="RP" value={entry.reversePickupCode} />
    </div>
  );
}

function EmptyCard() {
  return (
    <p className="py-6 text-[17px] text-muted-foreground">Scan the first parcel to start</p>
  );
}

export function LastScanCard({ entry }: { entry: DeskScanEntry | undefined }) {
  if (!entry) {
    return <EmptyCard />;
  }

  const style = RESULT_STYLE[entry.result];

  const Icon = style.icon;

  return (
    <div key={entry.id} className={cn('flex gap-4 rounded-sm px-5 py-4 animate-in fade-in-0', style.card)}>
      <Icon className="size-9 shrink-0" strokeWidth={1.75} />

      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="font-display text-[24px] font-semibold tracking-[-0.02em]">{SCAN_RESULT_LABEL[entry.result]}</h2>

          <Mono className="text-base opacity-75">{entry.code}</Mono>
        </div>

        <ReturnLine entry={entry} />

        <p className="text-sm">{style.instruction}</p>

        <EarlierScan entry={entry} />

        <RecreateDetails entry={entry} />
      </div>
    </div>
  );
}
