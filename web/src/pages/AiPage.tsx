import { useState } from 'react';
import { toast } from 'sonner';

import { BRIEF_KIND_LABEL, type Brief, BriefKind } from '@hexabuild/shared';

import { AskPanel } from '@/components/ai/AskPanel';
import { BriefCard } from '@/components/ai/BriefCard';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useAiStatus, useBriefs, useGenerateBrief } from '@/hooks/queries';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

function ScheduleNote() {
  const { data } = useAiStatus();

  if (!data) {
    return null;
  }

  const sentTo = data.webhookConfigured ? 'posted to the team channel and kept here' : 'kept here (no team channel set up)';

  return (
    <p className="mt-1 text-[12.5px] text-muted-foreground">
      Daily brief at {data.dailyAt}, handover notes at {data.handoverAt.join(' and ')}; {sentTo}. Engine: {data.provider}.
    </p>
  );
}

function GenerateButtons() {
  const generate = useGenerateBrief();

  function run(kind: BriefKind) {
    generate.mutate(kind, {
      onSuccess: () => toast.success(`${BRIEF_KIND_LABEL[kind]} written`),
      onError: error => toast.error(error.message),
    });
  }

  const busy = generate.isPending;

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => run(BriefKind.HANDOVER)}>
        Write handover note now
      </Button>

      <Button size="sm" variant="outline" disabled={busy} onClick={() => run(BriefKind.DAILY)}>
        Write daily brief now
      </Button>

      <BusyNote busy={busy} />
    </div>
  );
}

function BusyNote({ busy }: { busy: boolean }) {
  if (!busy) {
    return null;
  }

  return (
    <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
      <Spinner className="size-3" />
      Writing, about a minute
    </span>
  );
}

function HistoryList({ briefs, selectedId, onSelect }: { briefs: Brief[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <ul className="flex flex-col">
      {briefs.map(brief => (
        <li key={brief.id}>
          <button
            type="button"
            onClick={() => onSelect(brief.id)}
            className={cn(
              'flex w-full items-baseline justify-between gap-3 border-b py-2 text-left text-[13.5px] transition-colors hover:text-ink',
              brief.id === selectedId ? 'font-semibold text-ink' : 'text-muted-foreground'
            )}
          >
            <span>{BRIEF_KIND_LABEL[brief.kind]}</span>

            <span className="text-[12px] font-normal text-muted-foreground tabular-nums">{formatDateTime(brief.createdAt)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Briefs() {
  const { data, isPending } = useBriefs();

  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (isPending) {
    return <Skeleton className="h-96" />;
  }

  const briefs = data?.data ?? [];

  if (briefs.length === 0) {
    return <p className="py-2 text-[13.5px] text-muted-foreground">No briefs yet. Write one now, or wait for the next scheduled time.</p>;
  }

  const selected = briefs.find(b => b.id === selectedId) ?? briefs[0];

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_220px]">
      <BriefCard brief={selected} />

      <div className="flex flex-col">
        <h3 className="border-b border-ink pb-1.5 text-[13px] font-medium text-ink">Earlier</h3>

        <HistoryList briefs={briefs} selectedId={selected.id} onSelect={setSelectedId} />
      </div>
    </div>
  );
}

export function AiPage() {
  return (
    <>
      <PageHeader title="Briefs & questions" description="Smart briefs written from the latest data, and answers to questions in plain words." />

      <div className="grid min-h-0 flex-1 content-start gap-12 overflow-y-auto px-8 pt-2 pb-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] xl:gap-14">
        <AskPanel />

        <section className="flex flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink pb-2">
            <div>
              <h2 className="font-display text-[16px] font-semibold tracking-[-0.01em] text-ink">Briefs</h2>

              <ScheduleNote />
            </div>

            <GenerateButtons />
          </div>

          <Briefs />
        </section>
      </div>
    </>
  );
}
