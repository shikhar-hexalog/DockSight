import { Download } from 'lucide-react';
import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';

import { ClockMode, type ScopeFilters, TIME_LEGS, TIME_LEG_LABEL, type TatDay, type TatReportResponse, TimeLeg } from '@hexabuild/shared';

import { Explained } from '@/components/common/Explained';
import { QueryError } from '@/components/common/QueryError';
import { DispatchPanel } from '@/components/reports/Dispatch';
import { InwardPanel } from '@/components/reports/Inward';
import { ClientFilter, ClockFilter, DateRangeFilter, FilterBar } from '@/components/filters/FilterBar';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTatReport } from '@/hooks/queries';
import { REPORT_SCOPE, type Scope, useScope } from '@/hooks/useScope';
import { exportUrls } from '@/lib/api';
import { EXPLAIN } from '@/lib/explanations';
import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';

const volumeConfig = {
  processed: { label: 'Processed in Uniware', color: 'var(--series-1)' },
  pending: { label: 'Still pending', color: 'var(--series-2)' },
} satisfies ChartConfig;

// One measure, two statistics: same hue, told apart by line style and label.
// Medians of the two legs that matter most: to processed, and the whole way to putaway.
const tatConfig = {
  processed: { label: 'Inward → processed', color: 'var(--series-1)' },
  putaway: { label: 'Inward → putaway closed', color: 'var(--series-2)' },
} satisfies ChartConfig;

const shortDay = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
});

const dayLabel = (day: string) => shortDay.format(new Date(`${day}T00:00:00`));

const hours = (value: number | null) => (value === null ? '—' : `${value}h`);

function Panel({ title, info, description, children }: { title: string; info: string; description: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="border-b border-ink pb-2">
        <h2 className="font-display text-[16px] font-semibold tracking-[-0.01em] text-ink">
          <Explained text={info}>{title}</Explained>
        </h2>

        <p className="mt-1 text-[12.5px] text-muted-foreground">{description}</p>
      </div>

      {children}
    </section>
  );
}

/** Each inward day's parcels, split into processed and still pending (stacked: the bar is everything that came in). */
function VolumeChart({ days }: { days: TatDay[] }) {
  const data = days.map(d => ({ day: dayLabel(d.day), processed: d.processed.total, pending: d.pending.total }));

  return (
    <ChartContainer config={volumeConfig} className="h-64 w-full">
      <BarChart data={data} margin={{ top: 8, left: 0, right: 0 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} stroke="var(--border)" />

        <XAxis dataKey="day" tickLine={false} axisLine={{ stroke: 'var(--ink)' }} tickMargin={8} minTickGap={16} />

        <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={40} tickCount={4} tickFormatter={value => formatCount(Number(value))} />

        <ChartTooltip cursor={{ fill: 'var(--muted)' }} content={<ChartTooltipContent className="min-w-52" />} />

        <ChartLegend verticalAlign="top" align="left" content={<ChartLegendContent className="justify-start pb-3" />} />

        {/* A 2px surface-coloured edge keeps the two segments apart. */}
        <Bar dataKey="processed" stackId="inward" fill="var(--color-processed)" stroke="var(--background)" strokeWidth={2} maxBarSize={22} />

        <Bar dataKey="pending" stackId="inward" fill="var(--color-pending)" stroke="var(--background)" strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={22} />
      </BarChart>
    </ChartContainer>
  );
}

function TatChart({ days }: { days: TatDay[] }) {
  const data = days.map(d => ({
    day: dayLabel(d.day),
    processed: d.legs[TimeLeg.INWARD_TO_PROCESSED].medianHours,
    putaway: d.legs[TimeLeg.INWARD_TO_PUTAWAY].medianHours,
  }));

  return (
    <ChartContainer config={tatConfig} className="h-64 w-full">
      <LineChart data={data} margin={{ top: 16, left: 0, right: 16 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />

        <XAxis dataKey="day" tickLine={false} axisLine={{ stroke: 'var(--ink)' }} tickMargin={8} minTickGap={16} />

        <YAxis tickLine={false} axisLine={false} width={44} tickCount={4} tickFormatter={value => `${value}h`} />

        <ChartTooltip
          content={<ChartTooltipContent formatter={(value, name) => `${tatConfig[name as keyof typeof tatConfig].label}: ${value}h`} />}
        />

        <ChartLegend verticalAlign="top" align="left" content={<ChartLegendContent className="justify-start pb-3" />} />

        {/* 8px markers with a 2px surface ring, so overlapping points stay readable. */}
        <Line dataKey="putaway" stroke="var(--color-putaway)" strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: 'var(--background)', fill: 'var(--color-putaway)' }} connectNulls />

        <Line dataKey="processed" stroke="var(--color-processed)" strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: 'var(--background)', fill: 'var(--color-processed)' }} connectNulls />
      </LineChart>
    </ChartContainer>
  );
}

const COURIER_COLUMNS = ['Courier', 'Came in', 'Not processed', 'Putaway pending', ...TIME_LEGS.map(leg => `${TIME_LEG_LABEL[leg]} (median)`)];

function CourierTable({ report }: { report: TatReportResponse }) {
  if (report.byCourier.length === 0) {
    return <p className="text-[13.5px] text-muted-foreground">Nothing came in during this period.</p>;
  }

  const num = 'text-right font-mono text-[12px] tabular-nums';

  return (
    <Table>
      <TableHeader className="[&_tr]:border-ink">
        <TableRow className="hover:bg-transparent">
          {COURIER_COLUMNS.map((column, index) => (
            <TableHead key={column} className={cn('h-9 text-[12.5px] font-normal text-muted-foreground first:pl-0', index > 0 && 'text-right')}>
              {column}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>

      <TableBody>
        {report.byCourier.map(row => (
          <TableRow key={row.courier} className="text-[13px]">
            <TableCell className="pl-0">{row.courier}</TableCell>

            <TableCell className={num}>{formatCount(row.received)}</TableCell>

            <TableCell className={cn(num, row.pending > 0 && 'text-overdue')}>{formatCount(row.pending)}</TableCell>

            <TableCell className={cn(num, row.putawayPending > 0 && 'text-overdue')}>{formatCount(row.putawayPending)}</TableCell>

            {TIME_LEGS.map(leg => (
              <TableCell key={leg} className={num}>
                {hours(row.legs[leg].medianHours)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function tatUnit(clock: ClockMode): string {
  return clock === ClockMode.WORKING ? 'Working hours (time on shift only)' : 'Hours, around the clock,';
}

function ReportBody({ scope }: { scope: ScopeFilters }) {
  const { data, error, isPending, refetch } = useTatReport(scope);

  if (isPending) {
    return <Skeleton className="mx-8 mt-4 h-96" />;
  }

  if (error) {
    return (
      <div className="px-8 py-4">
        <QueryError error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 content-start gap-x-14 gap-y-12 overflow-y-auto px-8 pt-2 pb-10 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <Panel
          title="Inward by day"
          info={EXPLAIN.inward}
          description="Each row is the parcels that reached our dock that day, followed through to Uniware. Click any number to see the returns behind it."
        >
          <InwardPanel scope={scope} days={data.days} processedWithoutDock={data.processedWithoutDock} />
        </Panel>
      </div>

      <Panel title="Came in per day: processed vs still pending" info={EXPLAIN.volume} description="Bar height is everything that came in that day.">
        <VolumeChart days={data.days} />
      </Panel>

      <Panel
        title="Time at the warehouse, by inward date"
        info={EXPLAIN.tat}
        description={`${tatUnit(data.clock)} from arriving at our dock to processed in Uniware. Median: half are faster.`}
      >
        <TatChart days={data.days} />
      </Panel>

      <div className="lg:col-span-2">
        <Panel title="TAT by courier" info={EXPLAIN.tatByCourier} description="Parcels that came in during the period, slowest first.">
          <CourierTable report={data} />
        </Panel>
      </div>

      <div className="lg:col-span-2">
        <Panel title="Dispatch" info={EXPLAIN.dispatch} description="Courier pickups and the cancellation check, per day.">
          <DispatchPanel scope={scope} />
        </Panel>
      </div>
    </div>
  );
}

/** Downloads for the period on screen. */
function ReportExports({ scope }: { scope: Scope }) {
  const { from, to } = scope.scope;

  const since = from ? startOfDay(from) : undefined;

  const until = to ? startOfDay(to, 1) : undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          <Download />
          Export
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem asChild>
          <a href={exportUrls.scans(since, until)} download>
            Received at the dock (this period)
          </a>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <a href={exportUrls.pending} download>
            Pending in Uniware (right now)
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Local midnight of a YYYY-MM-DD day (plus some days), as an instant. */
function startOfDay(day: string, plusDays = 0): string {
  const [year, month, date] = day.split('-').map(Number);

  return new Date(year, month - 1, date + plusDays).toISOString();
}

export function ReportsPage() {
  const scope = useScope(REPORT_SCOPE);

  return (
    <>
      <PageHeader
        title="Reports"
        description="Turnaround from the warehouse dock to Uniware, and where it slows down."
        actions={<ReportExports scope={scope} />}
      />

      <FilterBar
        filters={
          <>
            <ClientFilter scope={scope} />

            <DateRangeFilter scope={scope} label="Period" hint="the days shown in the charts and tables" />
          </>
        }
        settings={<ClockFilter />}
      />

      <ReportBody scope={scope.scope} />
    </>
  );
}
