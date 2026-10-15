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
    <p className="text-xs text-muted-foreground">
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
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
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
              'flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-muted',
              brief.id === selectedId && 'bg-muted font-medium'
            )}
          >
            <span>{BRIEF_KIND_LABEL[brief.kind]}</span>

            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{formatDateTime(brief.createdAt)}</span>
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
    return <p className="rounded-lg border p-6 text-sm text-muted-foreground">No briefs yet. Write one now, or wait for the next scheduled time.</p>;
  }

  const selected = briefs.find(b => b.id === selectedId) ?? briefs[0];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_200px]">
      <BriefCard brief={selected} />

      <div className="flex flex-col gap-2">
        <h3 className="px-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Earlier</h3>

        <HistoryList briefs={briefs} selectedId={selected.id} onSelect={setSelectedId} />
      </div>
    </div>
  );
}

export function AiPage() {
  return (
    <>
      <PageHeader title="Briefs & questions" description="Briefs the AI writes from the latest data, and answers to questions in plain words." />

      <div className="grid min-h-0 flex-1 gap-8 overflow-y-auto p-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <AskPanel />

        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">Briefs</h2>

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
