import { ReturnSort, STAGE_LABEL, type ScopeFilters, Stage, type StageCount } from '@hexabuild/shared';

import { QueryError } from '@/components/common/QueryError';
import { StageDot } from '@/components/returns/StageBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { useReturns } from '@/hooks/queries';
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

function LateChip({ count }: { count: number }) {
  if (count === 0) {
    return null;
  }

  return (
    <span className="rounded-[4px] bg-overdue/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-overdue tabular-nums">
      {formatCount(count)} late
    </span>
  );
}

function ShownOfTotal({ shown, total }: { shown: number; total: number }) {
  if (shown >= total) {
    return null;
  }

  return (
    <p className="pt-1 text-center text-[11px] text-muted-foreground">
      Latest {formatCount(shown)} of {formatCount(total)}
    </p>
  );
}

function ColumnHeader({ stage, count }: { stage: Stage; count: StageCount | undefined }) {
  return (
    <div className="flex flex-col gap-0.5 px-1 pb-2">
      <div className="flex items-center gap-2">
        <StageDot stage={stage} className="size-2" />

        <h2 className="text-[13px] font-medium">{STAGE_LABEL[stage]}</h2>

        <span className="font-mono text-[12px] text-muted-foreground tabular-nums">{formatCount(count?.count ?? 0)}</span>

        <span className="ml-auto">
          <LateChip count={count?.overSla ?? 0} />
        </span>
      </div>

      <p className="text-[11px] text-muted-foreground">{STAGE_HINT[stage]}</p>
    </div>
  );
}

function ColumnSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-[84px] w-full" />
      ))}
    </div>
  );
}

function ColumnCards({ stage, scope }: { stage: Stage; scope: ScopeFilters }) {
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
    return <div className="grid h-24 place-items-center rounded-md border border-dashed text-xs text-muted-foreground">Nothing here</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      {data.data.map(summary => (
        <ReturnCard key={summary.id} summary={summary} onOpen={open} />
      ))}

      <ShownOfTotal shown={data.data.length} total={data.total} />
    </div>
  );
}

export function StageColumn({ stage, count, scope }: { stage: Stage; count: StageCount | undefined; scope: ScopeFilters }) {
  return (
    <section className="flex w-[300px] shrink-0 flex-col rounded-lg bg-muted/50 p-2">
      <ColumnHeader stage={stage} count={count} />

      <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 pb-1">
        <ColumnCards stage={stage} scope={scope} />
      </div>
    </section>
  );
}
