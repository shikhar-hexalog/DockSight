// Dispatch per day: courier pickups, parcels handed over, cancelled orders
// caught and what happened to them, and rider-count mismatches.

import { Download } from 'lucide-react';

import type { DispatchDay, ScopeFilters } from '@hexabuild/shared';

import { Explained } from '@/components/common/Explained';
import { QueryError } from '@/components/common/QueryError';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDispatchReport } from '@/hooks/queries';
import { exportUrls } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';

const longDay = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

type Column = { key: keyof Omit<DispatchDay, 'day'>; label: string; info: string; alert?: boolean };

const COLUMNS: Column[] = [
  { key: 'pickups', label: 'Pickups', info: 'Courier pickups (dispatch handovers) started that day.' },
  { key: 'handedOver', label: 'Handed over', info: 'Parcels that passed the cancellation check and went with the courier.' },
  { key: 'cancellationsCaught', label: 'Cancellations caught', info: 'Orders found cancelled after their parcel was put on a manifest.' },
  { key: 'pulled', label: 'Pulled out', info: 'Cancelled parcels taken out before the courier left: RTOs avoided.' },
  { key: 'missed', label: 'Slipped through', info: "Cancelled parcels handed over anyway: they'll come back as RTOs.", alert: true },
  {
    key: 'riderMismatches',
    label: 'Count mismatches',
    info: "Submitted pickups where the rider's count didn't match the parcels we cleared.",
    alert: true,
  },
];

const cell = 'text-right font-mono text-[12px] tabular-nums';

function Value({ value, alert }: { value: number; alert?: boolean }) {
  return (
    <span className={cn(value === 0 && 'text-muted-foreground/50', value > 0 && alert && 'font-semibold text-overdue')}>{formatCount(value)}</span>
  );
}

/** Local midnight of a YYYY-MM-DD day (plus some days), as an instant. */
function startOfDay(day: string, plusDays = 0): string {
  const [year, month, date] = day.split('-').map(Number);

  return new Date(year, month - 1, date + plusDays).toISOString();
}

function Downloads({ scope }: { scope: ScopeFilters }) {
  if (!scope.from || !scope.to) {
    return null;
  }

  const range = { since: startOfDay(scope.from), until: startOfDay(scope.to, 1) };

  return (
    <div className="flex gap-2">
      <Button asChild size="sm" variant="outline">
        <a href={exportUrls.handover(range)} download>
          <Download />
          Handover scans
        </a>
      </Button>

      <Button asChild size="sm" variant="outline">
        <a href={exportUrls.holds(range)} download>
          <Download />
          Cancellation holds
        </a>
      </Button>
    </div>
  );
}

export function DispatchPanel({ scope }: { scope: ScopeFilters }) {
  const { data, error, isPending, refetch } = useDispatchReport(scope);

  if (isPending) {
    return <Skeleton className="h-48" />;
  }

  if (error) {
    return <QueryError error={error} onRetry={() => void refetch()} />;
  }

  const total = (key: Column['key']) => data.days.reduce((sum, d) => sum + d[key], 0);

  return (
    <div className="flex flex-col gap-3">
      <Downloads scope={scope} />

      <Table>
        <TableHeader className="[&_tr]:border-ink">
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-9 text-[12.5px] font-normal text-muted-foreground pl-0">Day</TableHead>

            {COLUMNS.map(column => (
              <TableHead key={column.key} className="h-9 text-[12.5px] font-normal text-muted-foreground text-right">
                <Explained text={column.info}>{column.label}</Explained>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>

        <TableBody>
          <TableRow className="border-b-ink hover:bg-transparent">
            <TableCell className="pl-0 text-[13px] font-semibold text-ink">Whole period</TableCell>

            {COLUMNS.map(column => (
              <TableCell key={column.key} className={cn(cell, 'font-semibold')}>
                <Value value={total(column.key)} alert={column.alert} />
              </TableCell>
            ))}
          </TableRow>

          {[...data.days].reverse().map(day => (
            <TableRow key={day.day}>
              <TableCell className="pl-0 text-[13px] whitespace-nowrap">{longDay.format(new Date(`${day.day}T00:00:00`))}</TableCell>

              {COLUMNS.map(column => (
                <TableCell key={column.key} className={cell}>
                  <Value value={day[column.key]} alert={column.alert} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
