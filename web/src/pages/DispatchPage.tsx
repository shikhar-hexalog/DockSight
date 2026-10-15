import { CircleCheck, CloudOff, OctagonX, RefreshCw, Repeat, ShieldAlert, Trash2, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { BatchKind, DeskOpKind, type DispatchHold, type DispatchNotice, HandoverResult, HoldStatus, PulledVia, RemoteTarget } from '@hexabuild/shared';

import { type ExportFile, ExportMenu } from '@/components/common/ExportMenu';
import { Mono } from '@/components/common/Mono';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDesk } from '@/desk/DeskProvider';
import { BatchBar } from '@/desk/batch/BatchBar';
import { DispatchSheet } from '@/desk/batch/DispatchSheet';
import { StartBatchForm } from '@/desk/batch/StartBatchForm';
import { ScanInput } from '@/desk/components/ScanInput';
import { PhoneScannerButton } from '@/desk/phone/PhoneScannerButton';
import { type PhoneLink, usePhoneLink } from '@/desk/phone/usePhoneLink';
import { type HandoverEntry, useHandoverCheck } from '@/desk/useHandoverCheck';
import { uuid } from '@/desk/uuid';
import { useDemoMode } from '@/hooks/useDemoMode';
import { useClearDemoCancellations, useDemoCancellation, useDispatchNotices, useOverview, usePullHold, useRunGuard } from '@/hooks/queries';
import { exportUrls } from '@/lib/api';
import { formatAge, formatCount, formatDateTime, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

const DISPATCH_EXPORTS: ExportFile[] = [
  { label: 'Handover scans', url: exportUrls.handover },
  { label: 'Cancellation holds', url: exportUrls.holds },
];

interface ResultLook {
  icon: LucideIcon;
  title: string;
  instruction: string;
  card: string;
  text: string;
}

const RESULT_LOOK: Record<HandoverResult, ResultLook> = {
  [HandoverResult.STOP]: {
    icon: OctagonX,
    title: 'STOP: do not hand over',
    instruction: 'This order was cancelled. Take the parcel out of the handover pile.',
    card: 'bg-overdue text-white',
    text: 'text-white',
  },
  [HandoverResult.CLEAR]: {
    icon: CircleCheck,
    title: 'OK to hand over',
    instruction: 'No cancellation known for this parcel.',
    card: 'bg-ok text-white',
    text: 'text-ok',
  },
  [HandoverResult.ALREADY_PULLED]: {
    icon: Repeat,
    title: 'Already pulled out',
    instruction: 'This parcel was stopped before. Keep it out of the handover pile.',
    card: 'bg-signal text-ink',
    text: 'text-warn',
  },
  [HandoverResult.INVALID]: {
    icon: ShieldAlert,
    title: "Couldn't check this scan",
    instruction: 'Scan it again, or check the order in Uniware before handing it over.',
    card: 'bg-overdue text-white',
    text: 'text-overdue',
  },
};

function HoldFacts({ hold }: { hold: DispatchHold | null }) {
  if (!hold) {
    return null;
  }

  const reason = hold.cancellationReason ? ` · ${hold.cancellationReason}` : '';

  return (
    <p className="font-mono text-sm">
      {hold.saleOrderCode} · {hold.manifestCode ?? 'no manifest'} · cancelled {formatDateTime(hold.cancelledAt)}
      {reason}
    </p>
  );
}

function CheckingCard({ code }: { code: string }) {
  return (
    <div className="flex min-h-28 items-center gap-5 rounded-sm bg-muted p-6">
      <Spinner className="size-10 shrink-0" />

      <div className="flex flex-col gap-1">
        <h2 className="font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">Checking…</h2>

        <Mono className="text-base text-muted-foreground">{code}</Mono>

        <p className="text-sm">Hold the parcel until this turns green.</p>
      </div>
    </div>
  );
}

function OfflineClearCard({ code }: { code: string }) {
  return (
    <div className="flex min-h-28 items-center gap-5 rounded-sm bg-signal p-6 text-ink">
      <CloudOff className="size-14 shrink-0" strokeWidth={1.75} />

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="font-display text-[28px] font-semibold tracking-[-0.02em]">OK, based on the last known holds</h2>

          <Mono className="text-base opacity-80">{code}</Mono>
        </div>

        <p className="text-sm">The network is down, so a very recent cancellation might not show yet. It will be re-checked when it's back.</p>
      </div>
    </div>
  );
}

function CheckResultCard({ entry, offline }: { entry: HandoverEntry | undefined; offline: boolean }) {
  // Green only once the server agrees; a stop is shown at once, since that's the safe side.
  if (entry && entry.result === HandoverResult.CLEAR && !entry.synced) {
    if (offline) {
      return <OfflineClearCard code={entry.check.code} />;
    }

    return <CheckingCard code={entry.check.code} />;
  }

  if (!entry) {
    return (
      <p className="py-6 text-[17px] text-muted-foreground">Scan each parcel before it goes to the courier</p>
    );
  }

  const look = RESULT_LOOK[entry.result];

  const Icon = look.icon;

  return (
    <div key={`${entry.check.id}-${entry.result}`} className={cn('flex min-h-28 items-center gap-5 rounded-sm p-6 animate-in fade-in-0', look.card)}>
      <Icon className="size-14 shrink-0" strokeWidth={1.75} />

      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="font-display text-[28px] font-semibold tracking-[-0.02em]">{look.title}</h2>

          <Mono className="text-base opacity-80">{entry.check.code}</Mono>
        </div>

        <p className="text-sm">{look.instruction}</p>

        <HoldFacts hold={entry.hold} />
      </div>
    </div>
  );
}

function QueueNote({ queued }: { queued: number }) {
  if (queued === 0) {
    return null;
  }

  return (
    <span className="flex items-center gap-1.5 text-[13px] text-warn">
      <CloudOff className="size-3.5" />
      {formatCount(queued)} checks saved here, will sync. Answers use the last known holds.
    </span>
  );
}

/** Stages a cancelled-after-manifest order, as the guard would raise it, so STOP can be shown on cue. */
function DemoCancellationActions() {
  const { on } = useDemoMode();

  const stage = useDemoCancellation();

  const clear = useClearDemoCancellations();

  function onStage() {
    stage.mutate(undefined, {
      onSuccess: ({ code }) => toast.success(`Order for ${code} cancelled after manifest. It's on the pull list.`),
      onError: error => toast.error(error.message),
    });
  }

  function onClear() {
    clear.mutate(undefined, {
      onSuccess: ({ removed }) => toast.success(`Removed ${formatCount(removed)} demo cancellations`),
      onError: error => toast.error(error.message),
    });
  }

  if (!on) {
    return null;
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={onStage} disabled={stage.isPending}>
        Simulate a cancellation
      </Button>

      <Button size="sm" variant="ghost" onClick={onClear} disabled={clear.isPending}>
        Clear demo
      </Button>
    </>
  );
}

type Handover = ReturnType<typeof useHandoverCheck>;

const checkTime = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

const HANDED_OVER: HandoverResult[] = [HandoverResult.CLEAR];

const HELD_BACK: HandoverResult[] = [HandoverResult.STOP, HandoverResult.ALREADY_PULLED];

function CheckSyncMark({ synced }: { synced: boolean }) {
  if (synced) {
    return null;
  }

  return <CloudOff className="size-3.5 text-muted-foreground" aria-label="Saved here, will sync" />;
}

function RemoveCheckButton({ entry, onRemove }: { entry: HandoverEntry; onRemove: (id: string) => void }) {
  return (
    <button
      type="button"
      aria-label={`Remove ${entry.check.code}`}
      title="Remove this scan (wrong barcode, or not going with this courier)"
      onClick={() => {
        if (window.confirm(`Remove ${entry.check.code} from this pickup?`)) {
          onRemove(entry.check.id);
        }
      }}
      className="inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-overdue/10 hover:text-overdue"
    >
      <Trash2 className="size-3.5" />
    </button>
  );
}

function CheckRow({ entry, onRemove }: { entry: HandoverEntry; onRemove: (id: string) => void }) {
  const look = RESULT_LOOK[entry.result];

  return (
    <TableRow className="text-[13px]">
      <TableCell className="font-mono text-[12px] text-muted-foreground tabular-nums">{checkTime.format(new Date(entry.check.checkedAt))}</TableCell>

      <TableCell>
        <Mono>{entry.check.code}</Mono>
      </TableCell>

      <TableCell className={cn('text-xs font-medium', entry.result === HandoverResult.CLEAR ? 'text-ok' : 'text-overdue')}>{look.title}</TableCell>

      <TableCell>
        <Mono className="text-muted-foreground">{entry.hold?.saleOrderCode ?? '—'}</Mono>
      </TableCell>

      <TableCell className="text-muted-foreground">{entry.check.checkedBy}</TableCell>

      <TableCell className="w-6">
        <CheckSyncMark synced={entry.synced} />
      </TableCell>

      <TableCell className="w-10 text-right">
        <RemoveCheckButton entry={entry} onRemove={onRemove} />
      </TableCell>
    </TableRow>
  );
}

/** This pickup's scans, newest first, each removable. */
function CheckLog({ entries, onRemove }: { entries: HandoverEntry[]; onRemove: (id: string) => void }) {
  if (entries.length === 0) {
    return <p className="py-4 text-[13.5px] text-muted-foreground">Parcels scanned for this pickup will appear here.</p>;
  }

  return (
    <Table>
      <TableHeader className="[&_tr]:border-ink">
        <TableRow className="hover:bg-transparent">
          {['Time', 'Scanned', 'Result', 'Cancelled order', 'By', '', ''].map((column, index) => (
            <TableHead key={index} className="h-9 text-[12.5px] font-normal text-muted-foreground first:pl-0">
              {column}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>

      <TableBody>
        {entries.map(entry => (
          <CheckRow key={entry.check.id} entry={entry} onRemove={onRemove} />
        ))}
      </TableBody>
    </Table>
  );
}

function PickupCounts({ entries, queued }: { entries: HandoverEntry[]; queued: number }) {
  const handedOver = entries.filter(e => HANDED_OVER.includes(e.result)).length;

  const heldBack = entries.filter(e => HELD_BACK.includes(e.result)).length;

  return (
    <div className="flex items-baseline gap-4">
      <span className="flex items-baseline gap-1 text-[13px] text-muted-foreground">
        <span className="font-semibold text-ink tabular-nums">{formatCount(handedOver)}</span>
        cleared
      </span>

      <span className="flex items-baseline gap-1 text-[13px] text-muted-foreground">
        <span className={cn('font-semibold text-ink tabular-nums', heldBack > 0 && 'text-overdue')}>
          {formatCount(heldBack)}
        </span>
        held back
      </span>

      <QueueNote queued={queued} />
    </div>
  );
}

function HandoverPanel({ handover }: { handover: Handover }) {
  const { dispatchBatch } = useDesk();

  const { batchEntries, check, remove, queued, offline } = handover;

  if (!dispatchBatch) {
    return <StartBatchForm kind={BatchKind.DISPATCH} />;
  }

  const cleared = batchEntries.filter(e => HANDED_OVER.includes(e.result)).length;

  return (
    <section className="flex flex-col gap-4">
      <BatchBar
        kind={BatchKind.DISPATCH}
        batch={dispatchBatch}
        count={cleared}
        renderSheet={courierCount => <DispatchSheet batch={dispatchBatch} entries={batchEntries} courierCount={courierCount} />}
        extra={<PickupCounts entries={batchEntries} queued={queued} />}
      />

      <ScanInput disabled={false} onScan={check} />

      <CheckResultCard entry={batchEntries[0]} offline={offline} />

      <CheckLog entries={batchEntries} onRemove={id => void remove(id)} />
    </section>
  );
}

function PullButton({ hold }: { hold: DispatchHold }) {
  const { scanner } = useDesk();

  const pull = usePullHold();

  function onPull() {
    pull.mutate(
      { id: hold.id, pulledBy: scanner ?? 'Unknown' },
      {
        onSuccess: () => toast.success(`${hold.trackingNumber ?? hold.packageCode} marked as pulled out`),
        onError: error => toast.error(error.message),
      }
    );
  }

  return (
    <Button size="sm" variant="outline" disabled={pull.isPending} onClick={onPull}>
      Pulled out
    </Button>
  );
}

function HoldRow({ hold }: { hold: DispatchHold }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <Mono className="text-[13px] font-medium text-ink">{hold.trackingNumber ?? hold.packageCode}</Mono>

        <p className="truncate text-[12.5px] text-muted-foreground">
          {hold.saleOrderCode} · {hold.courier ?? 'Unknown courier'} · {hold.firstItemName ?? 'Item'}
        </p>
      </div>

      <span className="font-mono text-[12px] whitespace-nowrap text-overdue tabular-nums">cancelled {formatAge(hold.cancelledAt)} ago</span>

      <PullButton hold={hold} />
    </li>
  );
}

function groupByManifest(holds: DispatchHold[]): [string, DispatchHold[]][] {
  const groups = new Map<string, DispatchHold[]>();

  for (const hold of holds) {
    const key = hold.manifestCode ?? 'No manifest code';
    groups.set(key, [...(groups.get(key) ?? []), hold]);
  }

  return [...groups.entries()];
}

function PullList({ holds }: { holds: DispatchHold[] }) {
  const open = holds.filter(h => h.status === HoldStatus.OPEN);

  if (open.length === 0) {
    return (
      <p className="py-3 text-[13.5px] text-muted-foreground">Nothing to pull. No cancelled orders are waiting on a manifest.</p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {groupByManifest(open).map(([manifest, group]) => (
        <section key={manifest}>
          <div className="flex items-baseline justify-between border-b border-overdue pb-1.5">
            <Mono className="text-[13px] font-semibold text-ink">{manifest}</Mono>

            <span className="text-[12.5px] font-medium text-overdue">{formatCount(group.length)} to pull out</span>
          </div>

          <ul className="divide-y">
            {group.map(hold => (
              <HoldRow key={hold.id} hold={hold} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

const PULLED_VIA_LABEL: Record<PulledVia, string> = {
  [PulledVia.HANDOVER_SCAN]: 'stopped at handover scan',
  [PulledVia.MANUAL]: 'marked by hand',
};

function DoneRow({ hold }: { hold: DispatchHold }) {
  if (hold.status === HoldStatus.PULLED) {
    return (
      <li className="flex items-center justify-between gap-3 py-2 text-[13px]">
        <Mono>{hold.trackingNumber ?? hold.packageCode}</Mono>

        <span className="text-[12.5px] text-ok">
          Pulled by {hold.pulledBy}
          {hold.pulledVia ? `, ${PULLED_VIA_LABEL[hold.pulledVia]}` : ''}
        </span>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-3 py-2 text-[13px]">
      <Mono>{hold.trackingNumber ?? hold.packageCode}</Mono>

      <span className="text-[12.5px] text-overdue">Handed over anyway {formatDateTime(hold.missedAt)} · RTO coming</span>
    </li>
  );
}

function TodayDone({ holds }: { holds: DispatchHold[] }) {
  const done = holds.filter(h => h.status !== HoldStatus.OPEN);

  if (done.length === 0) {
    return null;
  }

  return (
    <section>
      <h3 className="border-b pb-1.5 text-[13px] font-medium text-muted-foreground">Today</h3>

      <ul className="divide-y">
        {done.map(hold => (
          <DoneRow key={hold.id} hold={hold} />
        ))}
      </ul>
    </section>
  );
}

function PullPanel({ holds }: { holds: DispatchHold[] }) {
  return (
    <section className="flex flex-col gap-5">
      <h2 className="border-b border-ink pb-2 font-display text-[16px] font-semibold text-ink">Pull from manifests</h2>

      <PullList holds={holds} />

      <TodayDone holds={holds} />
    </section>
  );
}

function GuardStatusLine() {
  const { data } = useOverview();

  const runGuard = useRunGuard();

  const guard = data?.dispatch.guard;

  function label() {
    if (runGuard.isPending) {
      return 'Checking Uniware…';
    }

    if (guard?.lastError) {
      return `Last check failed: ${guard.lastError}`;
    }

    return `Checked Uniware ${formatRelative(guard?.lastRunAt ?? null)} · every ${guard?.intervalMinutes ?? 2}m`;
  }

  return (
    <Button size="sm" variant="ghost" className="text-[13px] text-muted-foreground" onClick={() => runGuard.mutate()}>
      <RefreshCw className={cn('size-3.5', runGuard.isPending && 'animate-spin')} />
      {label()}
    </Button>
  );
}

function Totals() {
  const { data } = useOverview();

  if (!data) {
    return <Spinner className="mx-8 my-6" />;
  }

  const { open, pulledToday, missedToday } = data.dispatch;

  const tiles = [
    { label: 'To pull out now', value: open, tone: open > 0 ? 'text-overdue' : '' },
    { label: 'Pulled out today (RTOs avoided)', value: pulledToday, tone: 'text-ok' },
    { label: 'Handed over anyway today', value: missedToday, tone: missedToday > 0 ? 'text-overdue' : '' },
  ];

  return (
    <div className="mx-8 mt-2 grid grid-cols-3 border-t border-ink">
      {tiles.map(tile => (
        <div key={tile.label} className="flex flex-col pt-3 pr-4">
          <span className="text-[13px] text-muted-foreground">{tile.label}</span>

          <span className={cn('font-display text-[40px] leading-[1.1] font-semibold tracking-[-0.04em] text-ink tabular-nums', tile.tone)}>
            {formatCount(tile.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Sends each phone scan's outcome back to the phone. A STOP goes at once; an OK
 * only once the server has confirmed it, as on this screen.
 */
function usePhoneResults(handover: Handover, link: PhoneLink) {
  // Our check id -> the phone's scan id.
  const waiting = useRef(new Map<string, { scanId: string; code: string }>());

  useEffect(() => {
    for (const entry of handover.entries) {
      const pending = waiting.current.get(entry.check.id);

      if (pending && (entry.synced || entry.result === HandoverResult.STOP)) {
        waiting.current.delete(entry.check.id);
        link.report(pending.scanId, pending.code, entry.result);
      }
    }
  }, [handover.entries, link]);

  return (scanId: string, code: string) => {
    const checkId = handover.check(code);

    if (checkId) {
      waiting.current.set(checkId, { scanId, code });
    }
  };
}

const NOTICE_TOAST_MS = 5_000;

/** A notice changes when more of its emails go out (late scans, a retry that worked). */
const noticeKey = (notice: DispatchNotice) => `${notice.batchId}:${notice.sent}:${notice.failed}`;

/** A toast when a submitted handover's customer emails go out. What was already there when the page opened is not shown again. */
function useNotifiedToast() {
  const { data } = useDispatchNotices();

  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!data) {
      return;
    }

    if (!seen.current) {
      seen.current = new Set(data.data.map(noticeKey));
      return;
    }

    for (const notice of data.data) {
      if (seen.current.has(noticeKey(notice))) {
        continue;
      }

      seen.current.add(noticeKey(notice));

      if (notice.sent === 0) {
        toast.error('Clients not notified', {
          description: `${notice.courier} pickup${notice.error ? `: ${notice.error}` : ''}.`,
          duration: NOTICE_TOAST_MS,
        });
        continue;
      }

      const emails = `${formatCount(notice.sent)} dispatch ${notice.sent === 1 ? 'email' : 'emails'}`;

      toast.success('Clients notified', {
        description: `${emails} sent for the ${notice.courier} pickup${notice.recipient ? ` to ${notice.recipient}` : ''}${notice.failed > 0 ? `; ${formatCount(notice.failed)} failed` : ''}.`,
        duration: NOTICE_TOAST_MS,
        action: { label: 'View emails', onClick: () => window.open(data.inboxUrl, '_blank', 'noreferrer') },
      });
    }
  }, [data]);
}

function PhoneButton({ link }: { link: PhoneLink }) {
  const { dispatchBatch } = useDesk();

  if (!dispatchBatch) {
    return null;
  }

  return <PhoneScannerButton link={link} />;
}

export function DispatchPage() {
  const { scanner, dispatchBatch, queueDeskOp } = useDesk();

  const queueRemoval = useCallback(
    (checkId: string) =>
      queueDeskOp({
        kind: DeskOpKind.CHECK_REMOVE,
        id: uuid(),
        scanId: checkId,
        removedBy: scanner ?? 'Unknown',
        removedAt: new Date().toISOString(),
      }),
    [queueDeskOp, scanner]
  );

  // One instance for the page: it owns the offline queue and the hold cache.
  const handover = useHandoverCheck(scanner, dispatchBatch?.id ?? null, queueRemoval);

  const checkFromPhone = useRef<(scanId: string, code: string) => void>(() => undefined);

  const link = usePhoneLink(RemoteTarget.DISPATCH, ({ id, code }) => checkFromPhone.current(id, code));

  checkFromPhone.current = usePhoneResults(handover, link);

  useNotifiedToast();

  return (
    <>
      <PageHeader
        title="Dispatch"
        description="Scan each parcel as the courier picks it up. Cancelled orders are stopped before they leave; the rider signs for what they take."
        actions={
          <>
            <DemoCancellationActions />

            <PhoneButton link={link} />

            <ExportMenu files={DISPATCH_EXPORTS} />

            <GuardStatusLine />
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Totals />

        <div className="grid gap-10 px-8 pt-8 pb-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:gap-14">
          <HandoverPanel handover={handover} />

          <PullPanel holds={handover.holds} />
        </div>
      </div>
    </>
  );
}
