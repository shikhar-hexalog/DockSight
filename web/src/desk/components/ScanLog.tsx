import { Camera, CloudUpload, Trash2 } from 'lucide-react';

import { PARCEL_CONDITION_LABEL, RETURN_TYPE_LABEL, SCAN_RESULT_LABEL } from '@hexabuild/shared';

import { Mono } from '@/components/common/Mono';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useReturnSheet } from '@/hooks/useReturnSheet';
import { cn } from '@/lib/utils';

import type { DeskScanEntry } from '../localDb';
import { RESULT_STYLE } from '../scanResultStyle';

const COLUMNS = ['Time', 'Scanned', 'Result', 'Condition', 'Return', 'Type', 'Courier', 'Item', 'By', '', ''];

const timeFormat = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

function SyncMark({ synced }: { synced: boolean }) {
  if (synced) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <CloudUpload className="size-4 text-muted-foreground" />
      </TooltipTrigger>

      <TooltipContent>Saved on this computer; will sync</TooltipContent>
    </Tooltip>
  );
}

function ResultBadge({ entry }: { entry: DeskScanEntry }) {
  const style = RESULT_STYLE[entry.result];

  const Icon = style.icon;

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', style.text)}>
      <Icon className="size-3.5" />
      {SCAN_RESULT_LABEL[entry.result]}
    </span>
  );
}

function ConditionCell({ entry }: { entry: DeskScanEntry }) {
  if (!entry.condition) {
    return <span className="text-muted-foreground/60">—</span>;
  }

  return (
    <span className="flex max-w-[220px] flex-col">
      <span className="inline-flex items-center gap-1 text-xs font-medium text-overdue">
        {PARCEL_CONDITION_LABEL[entry.condition]}
        <Camera className={cn('size-3', !entry.hasPhoto && 'hidden')} />
      </span>

      <span className="truncate text-[11px] text-muted-foreground">{entry.conditionNote ?? ''}</span>
    </span>
  );
}

function ReturnCode({ entry }: { entry: DeskScanEntry }) {
  const { open } = useReturnSheet();

  if (!entry.returnId || !entry.sourceCode) {
    return <Mono className="text-muted-foreground">—</Mono>;
  }

  const returnId = entry.returnId;

  return (
    <button
      type="button"
      onClick={event => {
        event.stopPropagation();
        open(returnId);
      }}
      className="underline-offset-2 hover:underline"
    >
      <Mono className="text-muted-foreground">{entry.sourceCode}</Mono>
    </button>
  );
}

function LogRow({
  entry,
  selected,
  onSelect,
  onRemove,
}: {
  entry: DeskScanEntry;
  selected: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <TableRow className={cn('cursor-pointer text-[13px]', selected && 'bg-muted')} onClick={() => onSelect(entry.id)}>
      <TableCell className="font-mono text-[12px] text-muted-foreground tabular-nums">{timeFormat.format(new Date(entry.scannedAt))}</TableCell>

      <TableCell>
        <Mono>{entry.code}</Mono>
      </TableCell>

      <TableCell>
        <ResultBadge entry={entry} />
      </TableCell>

      <TableCell>
        <ConditionCell entry={entry} />
      </TableCell>

      <TableCell>
        <ReturnCode entry={entry} />
      </TableCell>

      <TableCell className="text-muted-foreground">{entry.type ? RETURN_TYPE_LABEL[entry.type] : '—'}</TableCell>

      <TableCell className="text-muted-foreground">{entry.courier ?? '—'}</TableCell>

      <TableCell className="max-w-[220px] truncate text-muted-foreground">{entry.firstItemName ?? '—'}</TableCell>

      <TableCell className="text-muted-foreground">{entry.scannedBy}</TableCell>

      <TableCell className="w-8">
        <SyncMark synced={entry.synced} />
      </TableCell>

      <TableCell className="w-10 text-right">
        <button
          type="button"
          aria-label={`Remove ${entry.code}`}
          title="Remove this scan"
          onClick={event => {
            event.stopPropagation();

            if (window.confirm(`Remove ${entry.code} from this handover?`)) {
              onRemove(entry.id);
            }
          }}
          className="inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
      </TableCell>
    </TableRow>
  );
}

interface ScanLogProps {
  entries: DeskScanEntry[];
  selectedId: string | null;
  /** Pick a row to tag its condition. */
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}

export function ScanLog({ entries, selectedId, onSelect, onRemove }: ScanLogProps) {
  if (entries.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">This handover's scans will appear here. Click one to tag its condition.</p>;
  }

  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-background">
        <TableRow className="hover:bg-transparent">
          {COLUMNS.map(column => (
            <TableHead key={column} className="h-9 text-xs font-medium text-muted-foreground">
              {column}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>

      <TableBody>
        {entries.map(entry => (
          <LogRow key={entry.id} entry={entry} selected={entry.id === selectedId} onSelect={onSelect} onRemove={onRemove} />
        ))}
      </TableBody>
    </Table>
  );
}
