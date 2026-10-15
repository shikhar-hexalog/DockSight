import { History, RefreshCw, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';

import {
  RETURN_TYPES,
  RETURN_TYPE_LABEL,
  type SyncAccount,
  type SyncCursor,
  SyncKind,
  type SyncRun,
  SyncStatus,
  type SyncStatusResponse,
  UniwareMode,
} from '@hexabuild/shared';

import { QueryError } from '@/components/common/QueryError';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useRunSync, useSyncStatus } from '@/hooks/queries';
import { formatCount, formatDateTime, formatElapsed, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

const STATUS_CLASS: Record<SyncStatus, string> = {
  [SyncStatus.RUNNING]: 'text-stage-expected',
  [SyncStatus.SUCCESS]: 'text-ok',
  [SyncStatus.PARTIAL]: 'text-warn',
  [SyncStatus.FAILED]: 'text-overdue',
};

const KIND_LABEL: Record<SyncKind, string> = {
  [SyncKind.BACKFILL]: 'Backfill',
  [SyncKind.INCREMENTAL]: 'Incremental',
  [SyncKind.LOOKUP]: 'Scan lookup',
};

const RUN_COLUMNS = ['Started', 'Account', 'Kind', 'Status', 'Window', 'Fetched', 'New', 'Updated', 'Failed', 'Took'];

// Columns from this index on hold numbers and align right.
const FIRST_NUMBER_COLUMN = 5;

const ACCOUNT_COLUMNS = ['Account', 'Tenant', 'Facility', ...RETURN_TYPES.map(type => `${RETURN_TYPE_LABEL[type]} read up to`)];

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>

      <span className={cn('text-[13px]', mono && 'font-mono text-[12px]')}>{value}</span>
    </div>
  );
}

const SOURCE_DESCRIPTION: Record<UniwareMode, string> = {
  [UniwareMode.LIVE]: 'Uniware (live, read-only)',
  [UniwareMode.MOCK]: 'Mock data — add accounts to .env',
  [UniwareMode.IMPORT]: 'Uniware export files (npm run import)',
};

function StatusFacts({ status }: { status: SyncStatusResponse }) {
  const source = SOURCE_DESCRIPTION[status.mode];

  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-4 px-6 py-5 lg:grid-cols-4">
      <Fact label="Source" value={source} />

      <Fact label="Accounts syncing" value={formatCount(status.accounts.length)} />

      <Fact label="Last successful sync" value={formatRelative(status.lastSuccessAt)} />

      <Fact label="Next automatic sync" value={`${formatRelative(status.nextRunAt)} · every ${status.intervalMinutes}m`} />
    </div>
  );
}

function cursorFor(cursors: SyncCursor[], account: string, type: (typeof RETURN_TYPES)[number]): string {
  const cursor = cursors.find(c => c.account === account && c.type === type);

  return cursor ? formatDateTime(cursor.lastUpdatedTo) : 'Not synced yet';
}

function AccountRow({ account, cursors }: { account: SyncAccount; cursors: SyncCursor[] }) {
  return (
    <TableRow className="text-[13px]">
      <TableCell className="font-mono text-[12px] font-medium">{account.key}</TableCell>

      <TableCell className="font-mono text-[12px]">{account.tenant}</TableCell>

      <TableCell className="font-mono text-[12px]">{account.facility}</TableCell>

      {RETURN_TYPES.map(type => (
        <TableCell key={type} className="font-mono text-[12px] text-muted-foreground tabular-nums">
          {cursorFor(cursors, account.key, type)}
        </TableCell>
      ))}
    </TableRow>
  );
}

function AccountsTable({ status }: { status: SyncStatusResponse }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {ACCOUNT_COLUMNS.map(column => (
            <TableHead key={column} className="h-9 text-xs font-medium text-muted-foreground">
              {column}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>

      <TableBody>
        {status.accounts.map(account => (
          <AccountRow key={account.key} account={account} cursors={status.cursors} />
        ))}
      </TableBody>
    </Table>
  );
}

function IncompleteAccounts({ status }: { status: SyncStatusResponse }) {
  if (status.incompleteAccounts.length === 0) {
    return null;
  }

  return (
    <div className="mx-6 mb-4 flex flex-col gap-1.5 rounded-md border border-warn/40 bg-warn/5 px-4 py-3">
      <div className="flex items-center gap-2 text-[13px] font-medium">
        <TriangleAlert className="size-4 text-warn" />
        Some accounts in .env are skipped
      </div>

      {status.incompleteAccounts.map(account => (
        <p key={account.key} className="text-xs text-muted-foreground">
          Account <span className="font-mono">{account.key}</span> is missing{' '}
          <span className="font-mono">{account.missing.join(', ')}</span>
        </p>
      ))}
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <h2 className="px-6 pt-4 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{children}</h2>;
}

function runDuration(run: SyncRun): string {
  if (!run.finishedAt) {
    return '…';
  }

  return formatElapsed(new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime());
}

function runWindow(run: SyncRun): string {
  if (!run.windowFrom || !run.windowTo) {
    return '—';
  }

  return `${formatDateTime(run.windowFrom)} → ${formatDateTime(run.windowTo)}`;
}

function RunStatus({ run }: { run: SyncRun }) {
  const label = <span className={cn('text-xs font-medium', STATUS_CLASS[run.status])}>{run.status.toLowerCase()}</span>;

  if (!run.error) {
    return label;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help underline decoration-dotted underline-offset-2">{label}</span>
      </TooltipTrigger>

      <TooltipContent className="max-w-sm">{run.error}</TooltipContent>
    </Tooltip>
  );
}

function RunRow({ run }: { run: SyncRun }) {
  const numberCell = 'text-right font-mono text-[12px] tabular-nums';

  return (
    <TableRow className="text-[13px]">
      <TableCell className="font-mono text-[12px] tabular-nums">{formatDateTime(run.startedAt)}</TableCell>

      <TableCell className="font-mono text-[12px]">{run.account ?? '—'}</TableCell>

      <TableCell>{KIND_LABEL[run.kind]}</TableCell>

      <TableCell>
        <RunStatus run={run} />
      </TableCell>

      <TableCell className="font-mono text-[11px] text-muted-foreground">{runWindow(run)}</TableCell>

      <TableCell className={numberCell}>{formatCount(run.fetched)}</TableCell>

      <TableCell className={numberCell}>{formatCount(run.created)}</TableCell>

      <TableCell className={numberCell}>{formatCount(run.updated)}</TableCell>

      <TableCell className={cn(numberCell, run.failed > 0 && 'text-overdue')}>{formatCount(run.failed)}</TableCell>

      <TableCell className={cn(numberCell, 'text-muted-foreground')}>{runDuration(run)}</TableCell>
    </TableRow>
  );
}

function RunsTable({ runs }: { runs: SyncRun[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {RUN_COLUMNS.map((column, index) => (
            <TableHead
              key={column}
              className={cn('h-9 text-xs font-medium text-muted-foreground', index >= FIRST_NUMBER_COLUMN && 'text-right')}
            >
              {column}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>

      <TableBody>
        {runs.map(run => (
          <RunRow key={run.id} run={run} />
        ))}
      </TableBody>
    </Table>
  );
}

function SyncActions({ running }: { running: boolean }) {
  const runSync = useRunSync();

  function start(kind: SyncKind) {
    runSync.mutate(kind, {
      onSuccess: () => toast.success(`${KIND_LABEL[kind]} sync started`),
      onError: error => toast.error(error.message),
    });
  }

  const disabled = running || runSync.isPending;

  return (
    <>
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => start(SyncKind.BACKFILL)}>
        <History />
        Reload history
      </Button>

      <Button size="sm" disabled={disabled} onClick={() => start(SyncKind.INCREMENTAL)}>
        <RefreshCw />
        Sync now
      </Button>
    </>
  );
}

function SyncBody({ status }: { status: SyncStatusResponse }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <StatusFacts status={status} />

      <IncompleteAccounts status={status} />

      <div className="border-t">
        <SectionTitle>Accounts</SectionTitle>

        <div className="px-3 pb-2">
          <AccountsTable status={status} />
        </div>
      </div>

      <div className="border-t">
        <SectionTitle>Recent syncs</SectionTitle>

        <div className="px-3 pb-4">
          <RunsTable runs={status.runs} />
        </div>
      </div>
    </div>
  );
}

function SyncContent() {
  const { data, error, isPending, refetch } = useSyncStatus();

  if (isPending) {
    return <Skeleton className="m-6 h-40" />;
  }

  if (error) {
    return (
      <div className="p-6">
        <QueryError error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  return <SyncBody status={data} />;
}

export function SyncPage() {
  const { data } = useSyncStatus();

  return (
    <>
      <PageHeader
        title="Uniware sync"
        description="We copy returns from Uniware into our own database and keep them up to date. Uniware is never written to."
        actions={<SyncActions running={data?.running ?? false} />}
        hideSyncIndicator
      />

      <SyncContent />
    </>
  );
}
