import type { ReactNode } from 'react';

import { RETURN_TYPE_LABEL, type ReturnDetail, STAGE_LABEL } from '@hexabuild/shared';

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
import { TimeBreakdown } from './TimeBreakdown';

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="px-8 pt-7">
      <div className="mb-1 flex items-baseline justify-between border-b border-ink pb-2">
        <h3 className="font-display text-[15px] font-semibold text-ink">{title}</h3>

        <span className="text-[12.5px] text-muted-foreground">{aside}</span>
      </div>

      {children}
    </section>
  );
}

/** The parcel's AWB, up top where staff look for it: the return AWB, else the forward one. */
function HeaderAwb({ detail }: { detail: ReturnDetail }) {
  const awb = detail.rtoTrackingNumber ?? detail.trackingNumber;

  if (!awb) {
    return null;
  }

  return (
    <p className="mt-0.5 text-[13px] text-muted-foreground">
      AWB <Mono className="text-[12.5px] font-medium text-ink">{awb}</Mono>
    </p>
  );
}

function DetailHeader({ detail }: { detail: ReturnDetail }) {
  return (
    <SheetHeader className="gap-0 px-8 pt-7 pb-0">
      <SheetDescription className="pr-8 font-display text-[24px] leading-[1.15] font-semibold tracking-[-0.03em] text-ink">
        {detail.firstItemName ?? 'Return'}
      </SheetDescription>

      <SheetTitle asChild>
        <p className="mt-1.5 text-[13px] font-normal text-muted-foreground">
          {RETURN_TYPE_LABEL[detail.type]} · <Mono className="text-[12.5px] text-ink">{detail.sourceCode}</Mono>
        </p>
      </SheetTitle>

      <HeaderAwb detail={detail} />

      <p className="mt-4 flex items-baseline gap-1.5 text-[15px]">
        <span className="font-semibold text-ink">{STAGE_LABEL[detail.stage]}</span>

        <span className="text-muted-foreground">for</span>

        <AgeInStage stage={detail.stage} since={detail.stageChangedAt} className="text-[14px]" />
      </p>
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

      <Section title="Items" aside={itemsLabel}>
        <ReturnItems items={detail.items} />
      </Section>

      <Section title="Details">
        <ReturnIdentifiers detail={detail} />
      </Section>

      <Section title="Activity">
        <ReturnActivity events={detail.events} />
      </Section>

      <div className="h-10" />
    </>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-8 py-7">
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
      <div className="px-8 py-7">
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
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[560px]">
        <OpenDetail id={openId} />
      </SheetContent>
    </Sheet>
  );
}
