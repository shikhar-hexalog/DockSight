import type { ReturnSummary } from '@hexabuild/shared';

import { Mono } from '@/components/common/Mono';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useReturnSheet } from '@/hooks/useReturnSheet';
import { formatDate } from '@/lib/format';

import { AgeInStage } from './AgeInStage';
import { StageBadge } from './StageBadge';
import { TypeTag } from './TypeTag';

const COLUMNS = ['Return', 'Item', 'Stage', 'In stage', 'Courier', 'Return AWB', 'Reason', 'Created'];

function ItemCell({ summary }: { summary: ReturnSummary }) {
  const more = summary.itemCount > 1 ? ` +${summary.itemCount - 1}` : '';

  return (
    <span className="block max-w-[260px] truncate">
      {summary.firstItemName ?? 'Unnamed item'}
      <span className="text-muted-foreground">{more}</span>
    </span>
  );
}

function ReturnRow({ summary, onOpen }: { summary: ReturnSummary; onOpen: (id: string) => void }) {
  return (
    <TableRow className="cursor-pointer text-[13px]" onClick={() => onOpen(summary.id)}>
      <TableCell>
        <div className="flex items-center gap-1.5">
          <TypeTag type={summary.type} />

          <Mono className="font-medium">{summary.sourceCode}</Mono>
        </div>
      </TableCell>

      <TableCell>
        <ItemCell summary={summary} />
      </TableCell>

      <TableCell>
        <StageBadge stage={summary.stage} />
      </TableCell>

      <TableCell>
        <AgeInStage stage={summary.stage} since={summary.stageChangedAt} />
      </TableCell>

      <TableCell className="text-muted-foreground">{summary.courier ?? '—'}</TableCell>

      <TableCell>
        <Mono className="text-muted-foreground">{summary.trackingNumber ?? '—'}</Mono>
      </TableCell>

      <TableCell className="max-w-[200px] truncate text-muted-foreground">{summary.rtoReason ?? summary.firstReason ?? '—'}</TableCell>

      <TableCell className="font-mono text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">
        {formatDate(summary.sourceCreatedAt)}
      </TableCell>
    </TableRow>
  );
}

export function ReturnsTable({ rows }: { rows: ReturnSummary[] }) {
  const { open } = useReturnSheet();

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
        {rows.map(summary => (
          <ReturnRow key={summary.id} summary={summary} onOpen={open} />
        ))}
      </TableBody>
    </Table>
  );
}
