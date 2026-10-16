import { ALL_STAGES } from '@hexabuild/shared';

import { StageColumn } from '@/components/board/StageColumn';
import { ClientFilter, ClockFilter, DateRangeFilter, FilterBar } from '@/components/filters/FilterBar';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchBox } from '@/components/returns/SearchBox';
import { TypeFilter } from '@/components/returns/TypeFilter';
import { usePipeline } from '@/hooks/queries';
import { BOARD_SCOPE, useScope } from '@/hooks/useScope';
import { useSearchQuery } from '@/hooks/useSearchQuery';
import { useTypeFilter } from '@/hooks/useTypeFilter';

export function BoardPage() {
  const { type } = useTypeFilter();

  const scope = useScope(BOARD_SCOPE);

  const search = useSearchQuery();

  const { data: pipeline } = usePipeline(type, scope.scope);

  return (
    <>
      <PageHeader
        title="Board"
        description="Every return as a card, by stage. Longest waiting first; a red edge means it's past its time limit. Click a card for its details."
      />

      <FilterBar
        filters={
          <>
            <SearchBox value={search.text} onChange={search.setText} className="w-56" />

            <ClientFilter scope={scope} />

            {/* A card is in the period if it reached its column then: created, arrived, processed or put away. */}
            <DateRangeFilter
              scope={scope}
              label="Reached stage"
              hint="shows a card if it reached its current column in this period: created (Expected), arrived at the dock (Pending in Uniware), processed in Uniware (Manifested), putaway closed (Closed)"
            />

            <TypeFilter />
          </>
        }
        settings={<ClockFilter />}
      />

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
        {ALL_STAGES.map(stage => (
          <StageColumn key={stage} stage={stage} count={pipeline?.stages.find(s => s.stage === stage)} scope={scope.scope} />
        ))}
      </div>
    </>
  );
}
