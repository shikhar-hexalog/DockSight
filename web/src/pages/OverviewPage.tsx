import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';

import {
  BRIEF_KIND_LABEL,
  ClockMode,
  type OverviewResponse,
  RETURN_TYPE_LABEL,
  ReturnType,
  type TypeCounts,
  BATCH_UNSIGNED_WARN_HOURS,
  MovementKind,
} from '@hexabuild/shared';

import { QueryError } from '@/components/common/QueryError';
import { InfoTip } from '@/components/common/InfoTip';
import { ClockToggle } from '@/components/layout/ClockToggle';
import { PageHeader } from '@/components/layout/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { useBriefs, useOverview } from '@/hooks/queries';
import { useHoursFormatter } from '@/hooks/useClock';
import { formatCount, formatRelative } from '@/lib/format';
import { movementLink } from '@/hooks/useMovementFilter';
import { EXPLAIN } from '@/lib/explanations';
import { cn } from '@/lib/utils';
import { routes } from '@/routes';

const dayFormat = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

function splitLabel(counts: TypeCounts): string {
  return `${formatCount(counts[ReturnType.RTO])} ${RETURN_TYPE_LABEL[ReturnType.RTO]} · ${formatCount(counts[ReturnType.CIR])} ${RETURN_TYPE_LABEL[ReturnType.CIR]}`;
}

type HoursLabel = (hours: number | null) => string;

interface Tile {
  label: string;
  value: string;
  hint: string;
  to?: string;
  alert?: boolean;
  /** What the number means, shown on hover. */
  info: string;
}

function tilesFor(o: OverviewResponse, hoursLabel: HoursLabel): Tile[] {
  const tatHint = o.clock === ClockMode.WORKING ? 'Received → processed, working hours' : 'Received → processed in Uniware';

  return [
    { label: 'Expected', info: EXPLAIN.expected, value: formatCount(o.expected.total), hint: `${splitLabel(o.expected)} on the way` },
    {
      label: 'Received today',
      info: EXPLAIN.receivedToday,
      value: formatCount(o.receivedToday.total),
      hint: splitLabel(o.receivedToday),
      // The returns behind the number, from every desk and sheet (not just this desk's handover).
      to: movementLink(MovementKind.ARRIVED),
    },
    {
      label: 'Processed in Uniware today',
      info: EXPLAIN.processedToday,
      value: formatCount(o.processedToday.total),
      hint: splitLabel(o.processedToday),
      to: movementLink(MovementKind.PROCESSED),
    },
    {
      label: 'Pending in Uniware',
      info: EXPLAIN.pending,
      value: formatCount(o.pending.total),
      hint: `${formatCount(o.carriedOver)} carried over from before today`,
      to: routes.pending,
      alert: o.carriedOver > 0,
    },
    {
      label: 'Set aside (exceptions)',
      info: EXPLAIN.setAside,
      value: formatCount(o.exceptionsOpen),
      hint: 'Unexpected or cancelled parcels',
      to: routes.exceptions,
      alert: o.exceptionsOpen > 0,
    },
    { label: 'Median TAT today', info: EXPLAIN.medianTat, value: hoursLabel(o.tatTodayMedianHours), hint: tatHint, to: routes.reports },
    {
      label: 'Pull from dispatch',
      info: EXPLAIN.pullFromDispatch,
      value: formatCount(o.dispatch.open),
      hint: `${formatCount(o.dispatch.pulledToday)} RTOs avoided today`,
      to: routes.dispatch,
      alert: o.dispatch.open > 0,
    },
    {
      label: 'Handovers to sign',
      info: EXPLAIN.handoversToSign,
      value: formatCount(o.batches.open),
      hint: `${formatCount(o.batches.unsignedOverdue)} open over ${BATCH_UNSIGNED_WARN_HOURS}h without a signed sheet`,
      to: routes.receive,
      alert: o.batches.unsignedOverdue > 0,
    },
  ];
}

function TileLink({ tile }: { tile: Tile }) {
  const body = (
    <>
      <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          {tile.label}
          <InfoTip text={tile.info} />
        </span>
        <ArrowRight className={cn('size-3.5 opacity-0 transition-opacity group-hover:opacity-100', !tile.to && 'hidden')} />
      </span>

      <span className={cn('text-3xl font-semibold tracking-tight tabular-nums', tile.alert && 'text-overdue')}>{tile.value}</span>

      <span className="line-clamp-2 text-xs text-muted-foreground" title={tile.hint}>
        {tile.hint}
      </span>
    </>
  );

  if (!tile.to) {
    return <div className="flex flex-col gap-1 p-5">{body}</div>;
  }

  return (
    <Link to={tile.to} className="group flex flex-col gap-1 p-5 transition-colors hover:bg-muted/50">
      {body}
    </Link>
  );
}

function Tiles({ overview }: { overview: OverviewResponse }) {
  const hoursLabel = useHoursFormatter();

  return (
    <div className="grid grid-cols-2 border-b md:grid-cols-4 xl:grid-cols-8 [&>*]:border-r [&>*]:border-b xl:[&>*]:border-b-0">
      {tilesFor(overview, hoursLabel).map(tile => (
        <TileLink key={tile.label} tile={tile} />
      ))}
    </div>
  );
}

function Panel({ title, info, action, children }: { title: string; info: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          {title}
          <InfoTip text={info} />
        </h2>

        {action}
      </div>

      {children}
    </section>
  );
}

function Bar({ label, value, max, tone, trailing }: { label: string; value: number; max: number; tone: string; trailing: string }) {
  const width = max === 0 ? 0 : Math.max(2, (value / max) * 100);

  return (
    <div className="grid grid-cols-[120px_1fr_auto] items-center gap-3 text-[13px]">
      <span className="truncate text-muted-foreground">{label}</span>

      <div className="h-2 rounded-full bg-muted">
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${value === 0 ? 0 : width}%` }} />
      </div>

      <span className="w-24 text-right font-mono text-[12px] tabular-nums">{trailing}</span>
    </div>
  );
}

// Older pending work is more urgent: the bars get warmer with age.
const AGE_TONES = ['bg-stage-processed', 'bg-stage-expected', 'bg-warn', 'bg-overdue'];

function PendingAges({ overview }: { overview: OverviewResponse }) {
  const max = Math.max(...overview.pendingAges.map(bucket => bucket.count));

  return (
    <Panel
      title="How long pending returns have waited"
      info={EXPLAIN.pendingAges}
      action={
        <Link to={routes.pending} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
          See all
        </Link>
      }
    >
      <div className="flex flex-col gap-3">
        {overview.pendingAges.map((bucket, index) => (
          <Bar key={bucket.label} label={bucket.label} value={bucket.count} max={max} tone={AGE_TONES[index]} trailing={formatCount(bucket.count)} />
        ))}
      </div>
    </Panel>
  );
}

function PendingByCourier({ overview }: { overview: OverviewResponse }) {
  const hoursLabel = useHoursFormatter();

  const max = Math.max(0, ...overview.pendingByCourier.map(c => c.count));

  if (overview.pendingByCourier.length === 0) {
    return (
      <Panel title="Pending by courier" info={EXPLAIN.pendingByCourier}>
        <p className="text-sm text-muted-foreground">Nothing pending.</p>
      </Panel>
    );
  }

  return (
    <Panel title="Pending by courier" info={EXPLAIN.pendingByCourier}>
      <div className="flex flex-col gap-3">
        {overview.pendingByCourier.map(courier => (
          <Bar
            key={courier.courier}
            label={courier.courier}
            value={courier.count}
            max={max}
            tone="bg-foreground/70"
            trailing={`${formatCount(courier.count)} · ${hoursLabel(courier.oldestHours)} max`}
          />
        ))}
      </div>
    </Panel>
  );
}

/** The newest AI brief's headline, so the overview opens with "what matters right now". */
function LatestBrief() {
  const { data } = useBriefs();

  const latest = data?.data[0];

  if (!latest) {
    return null;
  }

  return (
    <Link to={routes.ai} className="group flex items-center gap-3 border-b px-6 py-3 transition-colors hover:bg-muted/50">
      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        {BRIEF_KIND_LABEL[latest.kind]} · {formatRelative(latest.createdAt)}
        <InfoTip text={EXPLAIN.shiftBrief} />
      </span>

      <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{latest.content.headline}</span>

      <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function OverviewBody() {
  const { data, error, isPending, refetch } = useOverview();

  if (isPending) {
    return <Skeleton className="m-6 h-64" />;
  }

  if (error) {
    return (
      <div className="p-6">
        <QueryError error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <LatestBrief />

      <Tiles overview={data} />

      <div className="grid gap-4 p-6 lg:grid-cols-2">
        <PendingAges overview={data} />

        <PendingByCourier overview={data} />
      </div>
    </div>
  );
}

export function OverviewPage() {
  return (
    <>
      <PageHeader title="Returns today" description={dayFormat.format(new Date())} actions={<ClockToggle />} />

      <OverviewBody />
    </>
  );
}
