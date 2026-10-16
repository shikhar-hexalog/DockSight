import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { BATCH_UNSIGNED_WARN_HOURS, BRIEF_KIND_LABEL, MovementKind, type OverviewResponse, STAGE_LABEL, Stage } from '@hexabuild/shared';

import { Explained } from '@/components/common/Explained';
import { QueryError } from '@/components/common/QueryError';
import { ClockToggle } from '@/components/layout/ClockToggle';
import { PageHeader } from '@/components/layout/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { useBriefs, useOverview } from '@/hooks/queries';
import { useHoursFormatter } from '@/hooks/useClock';
import { movementLink } from '@/hooks/useMovementFilter';
import { BOARD_ALL_DATES } from '@/hooks/useScope';
import { EXPLAIN } from '@/lib/explanations';
import { formatCount, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { routes } from '@/routes';

const dayFormat = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

interface Attention {
  count: number;
  text: string;
  to: string;
}

/** Only what needs someone right now. */
function attentionFor(o: OverviewResponse): Attention[] {
  return [
    { count: o.dispatch.open, text: 'cancelled orders to pull before pickup', to: routes.dispatch },
    {
      count: o.batches.receiveOverdue,
      text: `receiving handover open over ${BATCH_UNSIGNED_WARN_HOURS}h without a signed sheet`,
      to: routes.receive,
    },
    {
      count: o.batches.dispatchOverdue,
      text: `courier pickup open over ${BATCH_UNSIGNED_WARN_HOURS}h without a signed sheet`,
      to: routes.dispatch,
    },
  ].filter(item => item.count > 0);
}

/** The newest brief's headline, then anything that needs someone, marked like hexalog.in's highlighter. */
function Lede({ overview }: { overview: OverviewResponse }) {
  const { data } = useBriefs();

  const latest = data?.data[0];

  const attention = attentionFor(overview);

  if (!latest && attention.length === 0) {
    return null;
  }

  return (
    <p className="max-w-[920px] px-8 pt-3 text-[15px] leading-[1.6]">
      {latest && (
        <>
          <Link to={routes.ai} className="mr-2 text-[13px] whitespace-nowrap text-muted-foreground underline-offset-[3px] hover:text-foreground hover:underline">
            <Explained text={EXPLAIN.shiftBrief}>
              {BRIEF_KIND_LABEL[latest.kind]} · {formatRelative(latest.createdAt)}
            </Explained>
          </Link>
          {latest.content.headline}{' '}
        </>
      )}

      {attention.length > 0 && <span className="mr-1.5 text-[13px] font-medium text-overdue">Needs attention</span>}

      {attention.map(item => (
        <span key={item.text}>
          <Link to={item.to} className="highlight hover:underline">
            {formatCount(item.count)} {item.text}
          </Link>{' '}
        </span>
      ))}
    </p>
  );
}

interface Figure {
  label: string;
  value: number;
  note: string;
  info: string;
  to?: string;
  late?: boolean;
}

/** The return's journey, in the same words as the Board. */
function figuresFor(o: OverviewResponse): Figure[] {
  return [
    { label: STAGE_LABEL[Stage.EXPECTED], value: o.expected.total, note: 'On the way, not at our dock yet', info: EXPLAIN.expected, to: `${routes.board}${BOARD_ALL_DATES}` },
    {
      label: 'Arrived at dock today',
      value: o.receivedToday.total,
      note: 'Scanned at the desk or from the sheet',
      info: EXPLAIN.receivedToday,
      to: movementLink(MovementKind.ARRIVED),
    },
    {
      label: STAGE_LABEL[Stage.RECEIVED],
      value: o.pending.total,
      note: `${formatCount(o.carriedOver)} waiting since before today`,
      info: EXPLAIN.pending,
      to: routes.pending,
      late: o.carriedOver > 0,
    },
    { label: STAGE_LABEL[Stage.MANIFESTED], value: o.manifested.total, note: 'In Uniware, putaway not closed yet', info: EXPLAIN.manifested, to: `${routes.board}${BOARD_ALL_DATES}` },
    {
      label: 'Closed today',
      value: o.closedToday.total,
      note: `${formatCount(o.closedTodayWithoutDock)} of them had no dock scan`,
      info: EXPLAIN.closedToday,
    },
  ];
}

function FigureBody({ figure }: { figure: Figure }) {
  return (
    <>
      <span className="text-[13px] text-muted-foreground">
        <Explained text={figure.info}>{figure.label}</Explained>
      </span>

      <span className="font-display text-[46px] leading-[1.1] font-semibold tracking-[-0.045em] text-ink tabular-nums group-hover:text-brand">{formatCount(figure.value)}</span>

      <span className={cn('text-[12.5px]', figure.late ? 'text-overdue' : 'text-muted-foreground')}>{figure.note}</span>
    </>
  );
}

function Figures({ overview }: { overview: OverviewResponse }) {
  return (
    <div className="mx-8 mt-7 grid grid-cols-2 gap-y-6 border-t border-ink md:grid-cols-5">
      {figuresFor(overview).map(figure =>
        figure.to ? (
          <Link key={figure.label} to={figure.to} className="group flex flex-col pt-3 pr-4">
            <FigureBody figure={figure} />
          </Link>
        ) : (
          <div key={figure.label} className="flex flex-col pt-3 pr-4">
            <FigureBody figure={figure} />
          </div>
        )
      )}
    </div>
  );
}

function Section({ title, info, action, children }: { title: string; info: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h2 className="flex items-baseline justify-between border-b border-ink pb-2 font-display text-[16px] font-semibold tracking-[-0.01em] text-ink">
        <Explained text={info}>{title}</Explained>

        {action}
      </h2>

      {children}
    </section>
  );
}

function Bar({ label, value, max, late, trailing }: { label: string; value: number; max: number; late?: boolean; trailing: string }) {
  const width = max === 0 || value === 0 ? 0 : Math.max(2, (value / max) * 100);

  return (
    <div className={cn('grid grid-cols-[170px_1fr_auto] items-center gap-4 border-b py-2 text-[13.5px]', late && 'text-overdue')}>
      <span className="truncate">{label}</span>

      <div className="h-1.5">
        <div className={cn('h-full', late ? 'bg-overdue' : 'bg-ink')} style={{ width: `${width}%` }} />
      </div>

      <span className={cn('min-w-8 text-right font-semibold tabular-nums', !late && 'text-ink')}>{trailing}</span>
    </div>
  );
}

// The first two buckets end at the 24h (or one working day) limit for a
// received return; everything from "1–2 days" on is late.
const FIRST_LATE_BUCKET = 2;

function PendingAges({ overview }: { overview: OverviewResponse }) {
  const max = Math.max(...overview.pendingAges.map(bucket => bucket.count));

  return (
    <Section
      title="Pending in Uniware: how long"
      info={EXPLAIN.pendingAges}
      action={
        <Link to={routes.pending} className="font-sans text-[13px] font-normal text-muted-foreground underline-offset-[3px] hover:text-foreground hover:underline">
          See all
        </Link>
      }
    >
      {overview.pendingAges.map((bucket, index) => (
        <Bar
          key={bucket.label}
          label={bucket.label}
          value={bucket.count}
          max={max}
          late={index >= FIRST_LATE_BUCKET && bucket.count > 0}
          trailing={formatCount(bucket.count)}
        />
      ))}
    </Section>
  );
}

function PendingByCourier({ overview }: { overview: OverviewResponse }) {
  const hoursLabel = useHoursFormatter();

  const max = Math.max(0, ...overview.pendingByCourier.map(c => c.count));

  return (
    <Section title="Pending in Uniware: by courier" info={EXPLAIN.pendingByCourier}>
      {overview.pendingByCourier.length === 0 && <p className="py-2 text-[13.5px] text-muted-foreground">Nothing pending.</p>}

      {overview.pendingByCourier.map(courier => (
        <Bar
          key={courier.courier}
          label={courier.courier}
          value={courier.count}
          max={max}
          trailing={`${formatCount(courier.count)} · ${hoursLabel(courier.oldestHours)} max`}
        />
      ))}
    </Section>
  );
}

function OverviewBody() {
  const { data, error, isPending, refetch } = useOverview();

  if (isPending) {
    return <Skeleton className="mx-8 mt-6 h-64" />;
  }

  if (error) {
    return (
      <div className="px-8 py-6">
        <QueryError error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-10">
      <Lede overview={data} />

      <Figures overview={data} />

      <div className="mt-10 grid gap-10 px-8 lg:grid-cols-2 lg:gap-14">
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
