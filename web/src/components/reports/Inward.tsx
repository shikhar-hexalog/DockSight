// Inward by day: the parcels that reached our dock each day, followed through
// to Uniware (processed / still pending / turnaround), plus the pile at the
// dock at the end of each day. Every number opens the returns behind it.

import { Download } from 'lucide-react';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from 'recharts';

import {
  type LegStats,
  MovementKind,
  type MovementDay,
  type ScopeFilters,
  TIME_LEGS,
  TIME_LEG_LABEL,
  type TatDay,
  TimeLeg,
} from '@hexabuild/shared';

import { Explained } from '@/components/common/Explained';
import { QueryError } from '@/components/common/QueryError';
import { ReturnsTable } from '@/components/returns/ReturnsTable';
import { SearchBox } from '@/components/returns/SearchBox';
import { Button } from '@/components/ui/button';
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useHoursFormatter } from '@/hooks/useClock';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useMovements, useReturns } from '@/hooks/queries';
import { exportUrls } from '@/lib/api';
import { EXPLAIN } from '@/lib/explanations';
import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';

// The drill-down shows the newest ones; the download has them all.
const LIST_LIMIT = 200;

const backlogConfig = {
  pending: { label: 'Waiting for Uniware at end of day', color: 'var(--chart-mark)' },
} satisfies ChartConfig;

const shortDay = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });

const longDay = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

const dayDate = (day: string) => new Date(`${day}T00:00:00`);

/** Which part of an inward day someone clicked. */
const InwardPart = {
  CAME_IN: 'came-in',
  PROCESSED: 'processed',
  PENDING: 'pending',
  PUTAWAY_PENDING: 'putaway-pending',
} as const;

type InwardPart = (typeof InwardPart)[keyof typeof InwardPart];

const PART: Record<InwardPart, { title: string; processed?: boolean; putawayPending?: boolean; info: string }> = {
  [InwardPart.CAME_IN]: { title: 'Came in', info: EXPLAIN.inwardCameIn },
  [InwardPart.PROCESSED]: { title: 'Processed', processed: true, info: EXPLAIN.inwardProcessed },
  [InwardPart.PENDING]: { title: 'Not processed', processed: false, info: EXPLAIN.inwardPending },
  [InwardPart.PUTAWAY_PENDING]: { title: 'Putaway pending', putawayPending: true, info: EXPLAIN.putawayPending },
};

const PARTS: InwardPart[] = [InwardPart.CAME_IN, InwardPart.PROCESSED, InwardPart.PENDING, InwardPart.PUTAWAY_PENDING];

const ALERT_PARTS: InwardPart[] = [InwardPart.PENDING, InwardPart.PUTAWAY_PENDING];

const LEG_INFO: Record<TimeLeg, string> = {
  [TimeLeg.INWARD_TO_PROCESSED]: EXPLAIN.legInwardProcessed,
  [TimeLeg.PROCESSED_TO_PUTAWAY]: EXPLAIN.legProcessedPutaway,
  [TimeLeg.INWARD_TO_PUTAWAY]: EXPLAIN.legInwardPutaway,
};

/** One number someone clicked: part of one inward day, or of the whole period. */
interface Pick {
  part: InwardPart;
  from?: string;
  to?: string;
  label: string;
}

function countOf(day: TatDay, part: InwardPart): number {
  if (part === InwardPart.PROCESSED) {
    return day.processed.total;
  }

  if (part === InwardPart.PENDING) {
    return day.pending.total;
  }

  if (part === InwardPart.PUTAWAY_PENDING) {
    return day.putawayPending;
  }

  return day.received.total;
}

/** Only the latest day and the peak get a number on their column; the tooltip carries the rest. */
function labelledDays(data: { pending: number }[]): Set<number> {
  const last = data.length - 1;

  const peak = data.reduce((best, d, i) => (d.pending > data[best].pending ? i : best), 0);

  return new Set([last, peak].filter(i => i >= 0 && data[i].pending > 0));
}

// End-of-day counts are separate snapshots, so one column per day, not a smoothed area.
function BacklogChart({ days }: { days: MovementDay[] }) {
  const data = days.map(d => ({ day: shortDay.format(dayDate(d.day)), pending: d.pendingAtClose }));

  const labelled = labelledDays(data);

  return (
    <ChartContainer config={backlogConfig} className="h-48 w-full">
      <BarChart data={data} margin={{ top: 20, left: 0, right: 0 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} stroke="var(--border)" />

        <XAxis dataKey="day" tickLine={false} axisLine={{ stroke: 'var(--ink)' }} tickMargin={8} minTickGap={16} />

        <YAxis
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          width={40}
          tickCount={4}
          tickFormatter={value => formatCount(Number(value))}
        />

        <ChartTooltip cursor={{ fill: 'var(--muted)' }} content={<ChartTooltipContent className="min-w-64 gap-2" />} />

        <Bar dataKey="pending" fill="var(--color-pending)" radius={[4, 4, 0, 0]} maxBarSize={22}>
          <LabelList
            dataKey="pending"
            position="top"
            content={props => (labelled.has(Number(props.index)) ? <LabelText {...props} /> : null)}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

/** The value on a column's cap, in ink (text never wears the series colour). */
function LabelText({ x, y, width, value }: { x?: number | string; y?: number | string; width?: number | string; value?: unknown }) {
  return (
    <text x={Number(x) + Number(width) / 2} y={Number(y) - 6} textAnchor="middle" className="fill-ink text-[12px] font-semibold tabular-nums">
      {formatCount(Number(value))}
    </text>
  );
}

function Backlog({ scope }: { scope: ScopeFilters }) {
  const { data } = useMovements(scope);

  if (!data) {
    return <Skeleton className="h-48" />;
  }

  return (
    <div>
      <h3 className="text-[13px] text-muted-foreground">
        <Explained text={EXPLAIN.pendingAtClose}>At the dock, waiting for Uniware, at the end of each day</Explained>
      </h3>

      <BacklogChart days={data.days} />
    </div>
  );
}

function CountButton({ value, onClick, strong, alert }: { value: number; onClick: () => void; strong?: boolean; alert?: boolean }) {
  if (value === 0) {
    return <span className="text-muted-foreground/50">0</span>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded px-1 tabular-nums underline-offset-2 hover:bg-muted hover:underline',
        strong && 'font-semibold',
        alert && 'text-overdue'
      )}
    >
      {formatCount(value)}
    </button>
  );
}

const cell = 'text-right font-mono text-[12px]';

function TotalsRow({ days, scope, onPick }: { days: TatDay[]; scope: ScopeFilters; onPick: (pick: Pick) => void }) {
  const total = (part: InwardPart) => days.reduce((sum, d) => sum + countOf(d, part), 0);

  return (
    <TableRow className="border-b-ink hover:bg-transparent">
      <TableCell className="pl-0 text-[13px] font-semibold text-ink">Whole period</TableCell>

      {PARTS.map(part => (
        <TableCell key={part} className={cell}>
          <CountButton
            strong
            alert={ALERT_PARTS.includes(part)}
            value={total(part)}
            onClick={() => onPick({ part, from: scope.from, to: scope.to, label: 'Came in during the whole period' })}
          />
        </TableCell>
      ))}

      <TableCell className={cn(cell, 'text-muted-foreground')} colSpan={TIME_LEGS.length}>
        per day below, and in the chart
      </TableCell>
    </TableRow>
  );
}

/** Median, with the slowest 1 in 10 underneath. */
function LegCell({ stats, hours }: { stats: LegStats; hours: (h: number | null) => string }) {
  if (stats.count === 0) {
    return <span className="text-muted-foreground/50">—</span>;
  }

  return (
    <span className="flex flex-col items-end">
      <span>{hours(stats.medianHours)}</span>

      <span className="text-[10px] text-muted-foreground">slowest 1/10: {hours(stats.p90Hours)}</span>
    </span>
  );
}

function DayRow({ day, onPick }: { day: TatDay; onPick: (pick: Pick) => void }) {
  const hours = useHoursFormatter();

  const label = longDay.format(dayDate(day.day));

  return (
    <TableRow>
      <TableCell className="pl-0 text-[13px] whitespace-nowrap">{label}</TableCell>

      {PARTS.map(part => (
        <TableCell key={part} className={cell}>
          <CountButton
            alert={ALERT_PARTS.includes(part)}
            value={countOf(day, part)}
            onClick={() => onPick({ part, from: day.day, to: day.day, label: `Came in on ${label}` })}
          />
        </TableCell>
      ))}

      {TIME_LEGS.map(leg => (
        <TableCell key={leg} className={cell}>
          <LegCell stats={day.legs[leg]} hours={hours} />
        </TableCell>
      ))}
    </TableRow>
  );
}

function Header({ label, info }: { label: string; info: string }) {
  return (
    <TableHead className="h-9 text-[12.5px] font-normal text-muted-foreground text-right">
      <Explained text={info}>{label}</Explained>
    </TableHead>
  );
}

function InwardTable({ days, scope, onPick }: { days: TatDay[]; scope: ScopeFilters; onPick: (pick: Pick) => void }) {
  return (
    <Table>
      <TableHeader className="[&_tr]:border-ink">
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-9 text-[12.5px] font-normal text-muted-foreground pl-0">Inward date</TableHead>

          {PARTS.map(part => (
            <Header key={part} label={PART[part].title} info={PART[part].info} />
          ))}

          {TIME_LEGS.map(leg => (
            <Header key={leg} label={TIME_LEG_LABEL[leg]} info={LEG_INFO[leg]} />
          ))}
        </TableRow>
      </TableHeader>

      <TableBody>
        <TotalsRow days={days} scope={scope} onPick={onPick} />

        {[...days].reverse().map(day => (
          <DayRow key={day.day} day={day} onPick={onPick} />
        ))}
      </TableBody>
    </Table>
  );
}

const SEARCH_DEBOUNCE_MS = 250;

function PickedResults({ pick, client, q }: { pick: Pick; client?: string; q: string | undefined }) {
  const part = PART[pick.part];

  const filters = { movement: MovementKind.ARRIVED, processed: part.processed, putawayPending: part.putawayPending, from: pick.from, to: pick.to, client, q };

  const { data, error, isPending, refetch } = useReturns({ ...filters, limit: LIST_LIMIT });

  if (isPending) {
    return <Skeleton className="h-64" />;
  }

  if (error) {
    return <QueryError error={error} onRetry={() => void refetch()} />;
  }

  if (data.total === 0) {
    return <p className="py-4 text-[13.5px] text-muted-foreground">Nothing in this list matches "{q}".</p>;
  }

  const shown =
    data.total > data.data.length ? `Newest ${formatCount(data.data.length)} of ${formatCount(data.total)}` : `${formatCount(data.total)} returns`;

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12.5px] text-muted-foreground">
          {shown}
          {q ? ` matching "${q}"` : ''}
        </span>

        <Button asChild size="sm" variant="outline">
          <a href={exportUrls.returns(filters)} download>
            <Download />
            Download {q ? 'these' : 'all'} {formatCount(data.total)}
          </a>
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <ReturnsTable rows={data.data} />
      </div>
    </>
  );
}

/** The returns behind one number, searchable within that list. */
function PickedList({ pick, client }: { pick: Pick; client?: string }) {
  const [search, setSearch] = useState('');

  const q = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS) || undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <SearchBox value={search} onChange={setSearch} />

      <PickedResults pick={pick} client={client} q={q} />
    </div>
  );
}

function PickedBody({ pick, client }: { pick: Pick | null; client?: string }) {
  if (!pick) {
    return null;
  }

  return <PickedList pick={pick} client={client} />;
}

function PickedSheet({ pick, client, onClose }: { pick: Pick | null; client?: string; onClose: () => void }) {
  return (
    <Sheet open={pick !== null} onOpenChange={open => !open && onClose()}>
      {/* Wide enough for the whole table: the default sheet is only 384px. */}
      <SheetContent side="right" className="gap-0 data-[side=right]:w-[min(1200px,95vw)] data-[side=right]:sm:max-w-none">
        <SheetHeader className="px-8 pt-7">
          <SheetTitle className="font-display text-[24px] font-semibold tracking-[-0.03em] text-ink">{pick ? PART[pick.part].title : ''}</SheetTitle>

          <SheetDescription>{pick?.label}. Click a return for its full history.</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col px-8 pb-6">
          <PickedBody pick={pick} client={client} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function NoDockNote({ count }: { count: number }) {
  if (count === 0) {
    return null;
  }

  return (
    <p className="text-[12.5px] text-muted-foreground">
      {formatCount(count)} returns were processed in this period with no dock record (never scanned or listed at our dock), so they have no inward
      date and aren't in these numbers.
    </p>
  );
}

export function InwardPanel({ scope, days, processedWithoutDock }: { scope: ScopeFilters; days: TatDay[]; processedWithoutDock: number }) {
  const [pick, setPick] = useState<Pick | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <Backlog scope={scope} />

      <InwardTable days={days} scope={scope} onPick={setPick} />

      <NoDockNote count={processedWithoutDock} />

      <PickedSheet pick={pick} client={scope.client} onClose={() => setPick(null)} />
    </div>
  );
}
