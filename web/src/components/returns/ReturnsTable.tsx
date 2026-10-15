import { RETURN_TYPE_LABEL, type ReturnSummary, STAGE_LABEL } from '@hexabuild/shared';

import { Mono } from '@/components/common/Mono';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useReturnSheet } from '@/hooks/useReturnSheet';
import { formatDate } from '@/lib/format';

import { AgeInStage } from './AgeInStage';

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
    <TableRow className="cursor-pointer text-[13.5px] hover:bg-muted/70" onClick={() => onOpen(summary.id)}>
      <TableCell className="pl-0">
        <span className="mr-2 text-[12px] text-muted-foreground">{RETURN_TYPE_LABEL[summary.type]}</span>

        <Mono className="text-[12.5px] text-ink">{summary.sourceCode}</Mono>
      </TableCell>

      <TableCell>
        <ItemCell summary={summary} />
      </TableCell>

      <TableCell className="whitespace-nowrap">{STAGE_LABEL[summary.stage]}</TableCell>

      <TableCell>
        <AgeInStage stage={summary.stage} since={summary.stageChangedAt} />
      </TableCell>

      <TableCell className="text-muted-foreground">{summary.courier ?? '—'}</TableCell>

      <TableCell>
        <Mono className="text-muted-foreground">{summary.trackingNumber ?? '—'}</Mono>
      </TableCell>

      <TableCell className="max-w-[200px] truncate text-muted-foreground">{summary.rtoReason ?? summary.firstReason ?? '—'}</TableCell>

      <TableCell className="pr-0 text-right text-[12.5px] whitespace-nowrap text-muted-foreground tabular-nums">
        {formatDate(summary.sourceCreatedAt)}
      </TableCell>
    </TableRow>
  );
}

export function ReturnsTable({ rows }: { rows: ReturnSummary[] }) {
  const { open } = useReturnSheet();

  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-background [&_tr]:border-ink">
        <TableRow className="hover:bg-transparent">
          {COLUMNS.map(column => (
            <TableHead key={column} className="h-9 text-[12.5px] font-normal text-muted-foreground first:pl-0 last:pr-0 last:text-right">
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
