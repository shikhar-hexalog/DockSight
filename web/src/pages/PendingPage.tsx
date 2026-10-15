import { Download } from 'lucide-react';

import { MS_PER_HOUR, RETURN_TYPE_LABEL, ReceivedSource, ReturnSort, type ReturnSummary, Stage } from '@hexabuild/shared';

import { Mono } from '@/components/common/Mono';
import { QueryError } from '@/components/common/QueryError';
import { ClockFilter, FilterBar } from '@/components/filters/FilterBar';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchBox } from '@/components/returns/SearchBox';
import { TypeFilter } from '@/components/returns/TypeFilter';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useReturns } from '@/hooks/queries';
import { useSearchQuery } from '@/hooks/useSearchQuery';
import { useReturnSheet } from '@/hooks/useReturnSheet';
import { useTypeFilter } from '@/hooks/useTypeFilter';
import { exportUrls } from '@/lib/api';
import { useStageAge } from '@/hooks/useStageAge';
import { formatCount, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 500;

// Same limits as the overview's age bars.
// Amber from this many hours of waiting; red once past the stage's limit.
const WARN_HOURS = 4;

const COLUMNS = ['Waiting', 'AWB', 'Return', 'Type', 'Courier', 'Arrived', 'Via', 'Uniware status', 'Item'];

const SOURCE_LABEL: Record<ReceivedSource, string> = {
  [ReceivedSource.DOCK]: 'Dock scan',
  [ReceivedSource.SHEET]: 'Receiving sheet',
};

function waitTone(late: boolean, ms: number): string {
  if (late) {
    return 'text-overdue font-semibold';
  }

  return ms >= WARN_HOURS * MS_PER_HOUR ? 'text-warn font-medium' : 'text-muted-foreground';
}

function Waiting({ receivedAt }: { receivedAt: string }) {
  const age = useStageAge(Stage.RECEIVED, receivedAt);

  return <span className={cn('font-mono text-[12.5px] tabular-nums', waitTone(age.late, age.ms))}>{age.label}</span>;
}

function WaitingCell({ receivedAt }: { receivedAt: string | null }) {
  if (!receivedAt) {
    return <span className="text-muted-foreground">—</span>;
  }

  return <Waiting receivedAt={receivedAt} />;
}

function PendingRow({ summary }: { summary: ReturnSummary }) {
  const { open } = useReturnSheet();

  return (
    <TableRow className="cursor-pointer text-[13.5px] hover:bg-muted/70" onClick={() => open(summary.id)}>
      <TableCell className="pl-0">
        <WaitingCell receivedAt={summary.receivedAt} />
      </TableCell>

      <TableCell>
        <Mono className="text-[12.5px] text-ink">{summary.trackingNumber ?? '—'}</Mono>
      </TableCell>

      <TableCell>
        <Mono className="text-[12.5px] text-ink">{summary.sourceCode}</Mono>
      </TableCell>

      <TableCell>{RETURN_TYPE_LABEL[summary.type]}</TableCell>

      <TableCell className="text-muted-foreground">{summary.courier ?? '—'}</TableCell>

      <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">{formatDateTime(summary.receivedAt)}</TableCell>

      <TableCell className="text-muted-foreground">{summary.receivedSource ? SOURCE_LABEL[summary.receivedSource] : '—'}</TableCell>

      <TableCell>
        <Mono className="text-muted-foreground">{summary.sourceStatus ?? '—'}</Mono>
      </TableCell>

      <TableCell className="max-w-[220px] truncate pr-0 text-muted-foreground">{summary.firstItemName ?? '—'}</TableCell>
    </TableRow>
  );
}

function PendingTable({ rows }: { rows: ReturnSummary[] }) {
  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-background [&_tr]:border-ink">
        <TableRow className="hover:bg-transparent">
          {COLUMNS.map(column => (
            <TableHead key={column} className="h-9 text-[12.5px] font-normal text-muted-foreground first:pl-0 last:pr-0">
              {column}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>

      <TableBody>
        {rows.map(row => (
          <PendingRow key={row.id} summary={row} />
        ))}
      </TableBody>
    </Table>
  );
}

function EmptyPending({ q }: { q: string | undefined }) {
  if (q) {
    return <p className="px-8 py-4 text-[13.5px] text-muted-foreground">No pending return matches "{q}".</p>;
  }

  return <p className="px-8 py-4 text-[13.5px] text-muted-foreground">Nothing is waiting on Uniware. Every received return is processed.</p>;
}

function PendingBody({ q }: { q: string | undefined }) {
  const { type } = useTypeFilter();

  const { data, error, isPending, refetch } = useReturns({ stage: Stage.RECEIVED, type, q, sort: ReturnSort.STAGE_AGE, limit: PAGE_SIZE });

  if (isPending) {
    return <Skeleton className="mx-8 mt-4 h-64" />;
  }

  if (error) {
    return (
      <div className="px-8 py-4">
        <QueryError error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  if (data.data.length === 0) {
    return <EmptyPending q={q} />;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <p className="px-8 pb-2 text-[12.5px] text-muted-foreground">
        {formatCount(data.total)} returns at the warehouse, not yet processed in Uniware. Oldest first.
      </p>

      <div className="px-8 pb-6">
        <PendingTable rows={data.data} />
      </div>
    </div>
  );
}

export function PendingPage() {
  const search = useSearchQuery();

  return (
    <>
      <PageHeader
        title="Pending in Uniware"
        description="Received at the warehouse but not yet processed in Uniware. This is the gap nobody could see before."
        actions={
          <Button asChild size="sm" variant="outline">
            <a href={exportUrls.pending}>
              <Download />
              Export
            </a>
          </Button>
        }
      />

      <FilterBar
        filters={
          <>
            <SearchBox value={search.text} onChange={search.setText} className="w-64" />

            <TypeFilter />
          </>
        }
        settings={<ClockFilter />}
      />

      <PendingBody q={search.q} />
    </>
  );
}
