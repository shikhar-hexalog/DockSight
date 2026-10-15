import { X } from 'lucide-react';
import { useState } from 'react';

import { ALL_STAGES, MOVEMENT_LABEL, ReturnSort, STAGE_LABEL, type Stage } from '@hexabuild/shared';

import { QueryError } from '@/components/common/QueryError';
import { PageHeader } from '@/components/layout/PageHeader';
import { ReturnsTable } from '@/components/returns/ReturnsTable';
import { SearchBox } from '@/components/returns/SearchBox';
import { TypeFilter } from '@/components/returns/TypeFilter';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useReturns } from '@/hooks/queries';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useMovementFilter } from '@/hooks/useMovementFilter';
import { dayString } from '@/hooks/useScope';
import { useTypeFilter } from '@/hooks/useTypeFilter';
import { formatCount } from '@/lib/format';

const PAGE_SIZE = 200;

const ANY_STAGE = 'ANY';

const SEARCH_DEBOUNCE_MS = 250;

function StageSelect({ value, onChange }: { value: Stage | undefined; onChange: (stage: Stage | undefined) => void }) {
  return (
    <Select value={value ?? ANY_STAGE} onValueChange={next => onChange(ALL_STAGES.find(stage => stage === next))}>
      <SelectTrigger size="sm" className="h-7 gap-1 border-0 bg-transparent px-0 text-[13px] text-muted-foreground shadow-none hover:text-foreground dark:bg-transparent">
        <SelectValue />
      </SelectTrigger>

      <SelectContent>
        <SelectItem value={ANY_STAGE}>All stages</SelectItem>

        {ALL_STAGES.map(stage => (
          <SelectItem key={stage} value={stage}>
            {STAGE_LABEL[stage]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-8 py-4">
      {Array.from({ length: 10 }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

function NoMatches() {
  return <div className="grid h-48 place-items-center text-sm text-muted-foreground">No returns match these filters</div>;
}

function ResultCount({ shown, total }: { shown: number; total: number }) {
  return (
    <span className="text-[12.5px] text-muted-foreground tabular-nums">
      {formatCount(shown)} of {formatCount(total)}
    </span>
  );
}

function Results({ stage, q }: { stage: Stage | undefined; q: string }) {
  const { type } = useTypeFilter();

  const { filter } = useMovementFilter();

  const { data, error, isPending, refetch } = useReturns({
    stage,
    type,
    q: q || undefined,
    sort: ReturnSort.RECENT,
    limit: PAGE_SIZE,
    ...(filter ?? {}),
  });

  if (isPending) {
    return <TableSkeleton />;
  }

  if (error) {
    return (
      <div className="px-8 py-4">
        <QueryError error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  if (data.data.length === 0) {
    return <NoMatches />;
  }

  return (
    <>
      <div className="flex justify-end px-8 pb-2">
        <ResultCount shown={data.data.length} total={data.total} />
      </div>

      <div className="px-8 pb-6">
        <ReturnsTable rows={data.data} />
      </div>
    </>
  );
}

const dayLabel = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

function periodLabel(from: string, to: string): string {
  const format = (day: string) => dayLabel.format(new Date(`${day}T00:00:00`));

  if (from === to) {
    return from === dayString(new Date()) ? 'today' : `on ${format(from)}`;
  }

  return `${format(from)} to ${format(to)}`;
}

/** The "Received today"-style filter a tile linked here with; click to clear it. */
function MovementChip() {
  const { filter, clear } = useMovementFilter();

  if (!filter) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={clear}
      className="flex items-center gap-1 text-[13px] font-semibold text-ink hover:text-brand"
    >
      {MOVEMENT_LABEL[filter.movement]} {periodLabel(filter.from, filter.to)}
      <X className="size-3.5" />
    </button>
  );
}

export function ReturnsPage() {
  const [search, setSearch] = useState('');

  const [stage, setStage] = useState<Stage | undefined>();

  const q = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);

  return (
    <>
      <PageHeader title="Returns" description="Search any code a worker might scan or a customer might quote." />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-8 pt-2 pb-4">
        <SearchBox value={search} onChange={setSearch} className="w-64" />

        <StageSelect value={stage} onChange={setStage} />

        <TypeFilter />

        <MovementChip />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Results stage={stage} q={q} />
      </div>
    </>
  );
}
