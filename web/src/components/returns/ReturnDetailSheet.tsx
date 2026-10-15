import type { ReactNode } from 'react';

import type { ReturnDetail } from '@hexabuild/shared';

import { Mono } from '@/components/common/Mono';
import { QueryError } from '@/components/common/QueryError';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useReturnDetail } from '@/hooks/queries';
import { useReturnSheet } from '@/hooks/useReturnSheet';
import { formatCount } from '@/lib/format';

import { AgeInStage } from './AgeInStage';
import { DockArrival } from './DockArrival';
import { ReturnActivity } from './ReturnActivity';
import { ReturnIdentifiers } from './ReturnIdentifiers';
import { ReturnItems } from './ReturnItems';
import { ReturnTimeline } from './ReturnTimeline';
import { StageBadge } from './StageBadge';
import { TimeBreakdown } from './TimeBreakdown';
import { TypeTag } from './TypeTag';

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t px-5 py-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{title}</h3>

        {aside}
      </div>

      {children}
    </section>
  );
}

function DetailHeader({ detail }: { detail: ReturnDetail }) {
  return (
    <SheetHeader className="gap-2 px-5 pt-5 pb-4">
      <div className="flex items-center gap-2">
        <TypeTag type={detail.type} />

        <SheetTitle asChild>
          <Mono className="text-[15px] font-semibold">{detail.sourceCode}</Mono>
        </SheetTitle>
      </div>

      <SheetDescription className="text-[13px]">{detail.firstItemName ?? 'Return'}</SheetDescription>

      <div className="flex items-center gap-2">
        <StageBadge stage={detail.stage} />

        <span className="text-xs text-muted-foreground">for</span>

        <AgeInStage stage={detail.stage} since={detail.stageChangedAt} />
      </div>
    </SheetHeader>
  );
}

function DetailBody({ detail }: { detail: ReturnDetail }) {
  const itemsLabel = `${formatCount(detail.items.length)} ${detail.items.length === 1 ? 'item' : 'items'}`;

  return (
    <>
      <DetailHeader detail={detail} />

      <Section title="Journey">
        <ReturnTimeline detail={detail} />
      </Section>

      <Section title="Time breakdown">
        <TimeBreakdown detail={detail} />
      </Section>

      <Section title="Dock arrival">
        <DockArrival arrival={detail.dockArrival} />
      </Section>

      <Section title="Items" aside={<span className="text-xs text-muted-foreground">{itemsLabel}</span>}>
        <ReturnItems items={detail.items} />
      </Section>

      <Section title="Details">
        <ReturnIdentifiers detail={detail} />
      </Section>

      <Section title="Activity">
        <ReturnActivity events={detail.events} />
      </Section>
    </>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-5">
      <Skeleton className="h-5 w-40" />

      <Skeleton className="h-4 w-64" />

      <Skeleton className="mt-4 h-32 w-full" />

      <Skeleton className="h-24 w-full" />
    </div>
  );
}

function DetailContent({ id }: { id: string }) {
  const { data, error, isPending, refetch } = useReturnDetail(id);

  if (isPending) {
    return <DetailSkeleton />;
  }

  if (error) {
    return (
      <div className="p-5">
        <SheetTitle className="sr-only">Return</SheetTitle>

        <QueryError error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  return <DetailBody detail={data} />;
}

function OpenDetail({ id }: { id: string | null }) {
  if (!id) {
    return null;
  }

  return <DetailContent id={id} />;
}

export function ReturnDetailSheet() {
  const { openId, close } = useReturnSheet();

  return (
    <Sheet open={openId !== null} onOpenChange={isOpen => !isOpen && close()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[440px]">
        <OpenDetail id={openId} />
      </SheetContent>
    </Sheet>
  );
}
