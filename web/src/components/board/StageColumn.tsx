import { isLate, ReturnSort, type ReturnSummary, STAGE_LABEL, type ScopeFilters, Stage, type StageCount } from '@hexabuild/shared';

import { QueryError } from '@/components/common/QueryError';
import { Skeleton } from '@/components/ui/skeleton';
import { useReturns } from '@/hooks/queries';
import { useClock } from '@/hooks/useClock';
import { useReturnSheet } from '@/hooks/useReturnSheet';
import { useTypeFilter } from '@/hooks/useTypeFilter';
import { formatCount } from '@/lib/format';
import { STAGE_HINT } from '@/lib/stage';

import { ReturnCard } from './ReturnCard';

// Done columns show only the latest; the board is for work in progress.
const COLUMN_LIMIT: Partial<Record<Stage, number>> = {
  [Stage.CLOSED]: 30,
  [Stage.CANCELLED]: 30,
};

const DEFAULT_LIMIT = 300;

// Work in progress shows the longest-waiting first; done columns the latest.
const COLUMN_SORT: Partial<Record<Stage, ReturnSort>> = {
  [Stage.CLOSED]: ReturnSort.RECENT,
  [Stage.CANCELLED]: ReturnSort.RECENT,
};

function ShownOfTotal({ shown, total }: { shown: number; total: number }) {
  if (shown >= total) {
    return null;
  }

  return (
    <p className="py-2.5 text-[12.5px] text-muted-foreground">
      Latest {formatCount(shown)} of {formatCount(total)}
    </p>
  );
}

function ColumnHeader({ stage, count }: { stage: Stage; count: StageCount | undefined }) {
  return (
    <div className="border-b border-ink pb-2">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-[15px] font-semibold text-ink">{STAGE_LABEL[stage]}</h2>

        <span className="font-display text-[24px] leading-none font-semibold tracking-[-0.03em] text-ink tabular-nums">
          {formatCount(count?.count ?? 0)}
        </span>
      </div>

      {/* Two lines reserved so every column's rule lines up, however long its hint. */}
      <p className="mt-1 line-clamp-2 min-h-[2lh] text-[12px] leading-[1.5] text-muted-foreground">{STAGE_HINT[stage]}</p>
    </div>
  );
}

/** Heads the late rows, in the words of the old "N late" chip. */
function LateLabel({ count }: { count: number }) {
  return <h3 className="pt-3.5 pb-0.5 text-[12px] font-medium text-overdue">{formatCount(count)} late</h3>;
}

function ColumnSkeleton() {
  return (
    <div className="flex flex-col gap-3 pt-3">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-[58px] w-full" />
      ))}
    </div>
  );
}

function Rows({ rows, onOpen }: { rows: ReturnSummary[]; onOpen: (id: string) => void }) {
  return rows.map(summary => <ReturnCard key={summary.id} summary={summary} onOpen={onOpen} />);
}

/**
 * Rows past the stage's time limit come first, under their own heading, so lateness needs no decoration.
 * Headings count the whole stage (from the pipeline), not just the rows loaded.
 */
function GroupedRows({ rows, count, onOpen }: { rows: ReturnSummary[]; count: StageCount | undefined; onOpen: (id: string) => void }) {
  const { mode, schedule } = useClock();

  const now = Date.now();

  const late = rows.filter(r => isLate(r.stage, r.stageChangedAt, now, mode, schedule));

  if (late.length === 0) {
    return <Rows rows={rows} onOpen={onOpen} />;
  }

  const onTime = rows.filter(r => !late.includes(r));

  return (
    <>
      <LateLabel count={count?.overSla ?? late.length} />
      <Rows rows={late} onOpen={onOpen} />

      {onTime.length > 0 && (
        <>
          <div className="mt-3 border-t border-ink/30" />
          <Rows rows={onTime} onOpen={onOpen} />
        </>
      )}
    </>
  );
}

function ColumnRows({ stage, count, scope }: { stage: Stage; count: StageCount | undefined; scope: ScopeFilters }) {
  const { type } = useTypeFilter();

  const { open } = useReturnSheet();

  const { data, error, isPending, refetch } = useReturns({
    ...scope,
    stage,
    type,
    sort: COLUMN_SORT[stage] ?? ReturnSort.STAGE_AGE,
    limit: COLUMN_LIMIT[stage] ?? DEFAULT_LIMIT,
  });

  if (isPending) {
    return <ColumnSkeleton />;
  }

  if (error) {
    return <QueryError error={error} onRetry={() => void refetch()} />;
  }

  if (data.data.length === 0) {
    return <p className="py-3 text-[13px] text-muted-foreground">Nothing here</p>;
  }

  return (
    <>
      <GroupedRows rows={data.data} count={count} onOpen={open} />

      <ShownOfTotal shown={data.data.length} total={data.total} />
    </>
  );
}

export function StageColumn({ stage, count, scope }: { stage: Stage; count: StageCount | undefined; scope: ScopeFilters }) {
  return (
    <section className="flex min-w-[260px] flex-1 flex-col">
      <ColumnHeader stage={stage} count={count} />

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        <ColumnRows stage={stage} count={count} scope={scope} />
      </div>
    </section>
  );
}
