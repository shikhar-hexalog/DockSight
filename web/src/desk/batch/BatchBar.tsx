// The current handover at the top of the desk, and closing it:
// rider's count -> print the sheet -> both sign -> photo of it -> submit.

import { CircleCheck, CircleX, FileText, Printer, RotateCcw, TriangleAlert, Truck } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { BatchKind, type BatchStart, type SheetCheck, type SheetCheckResponse, SheetVerdict, SignatureState } from '@hexabuild/shared';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { useDesk } from '@/desk/DeskProvider';
import { api } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';

import { PhotoPicker } from './PhotoPicker';

const startTime = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section className="flex gap-3">
      <span className={cn('grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold', done && 'border-ok bg-ok text-white')}>
        {n}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="text-sm font-medium">{title}</h3>

        {children}
      </div>
    </section>
  );
}

type SheetCheckState = { status: 'checking' } | { status: 'done'; response: SheetCheckResponse } | { status: 'failed'; message: string };

/** May the handover be submitted on this check? Only a clearly unsigned box or another document holds it back. */
function allowsSubmit(state: SheetCheckState): boolean {
  if (state.status !== 'done' || !state.response.check) {
    return state.status !== 'checking';
  }

  const blocking: SheetVerdict[] = [SheetVerdict.MISSING_SIGNATURE, SheetVerdict.NOT_A_SHEET];

  return !blocking.includes(state.response.check.verdict);
}

function missingWho(check: SheetCheck): string {
  const warehouse = check.warehouseSignature === SignatureState.MISSING;

  const rider = check.riderSignature === SignatureState.MISSING;

  if (warehouse && rider) {
    return 'Both signatures are missing';
  }

  if (warehouse) {
    return 'The warehouse signature is missing';
  }

  return "The rider's signature is missing";
}

function Banner({ tone, children }: { tone: 'ok' | 'warn' | 'bad'; children: ReactNode }) {
  const toneClass = { ok: 'border-ok/40 bg-ok/10', warn: 'border-warn/50 bg-warn/10', bad: 'border-overdue/40 bg-overdue/10' }[tone];

  return <div className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-sm', toneClass)}>{children}</div>;
}

/** The sheet's count against this handover's: a difference is worth a look, not a stop. */
function CountWarning({ check, parcels }: { check: SheetCheck; parcels: number }) {
  if (check.countOnSheet === null || check.countOnSheet === parcels) {
    return null;
  }

  return (
    <Banner tone="warn">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
      <span>
        The sheet shows {formatCount(check.countOnSheet)} parcels; this handover has {formatCount(parcels)}. Check before submitting.
      </span>
    </Banner>
  );
}

function CheckOutcome({ check, parcels }: { check: SheetCheck; parcels: number }) {
  if (check.verdict === SheetVerdict.APPROVED) {
    return (
      <>
        <Banner tone="ok">
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" />
          <span>
            <span className="font-semibold">Approved.</span> Smart check found both signatures ({check.seconds}s).
          </span>
        </Banner>

        <CountWarning check={check} parcels={parcels} />
      </>
    );
  }

  if (check.verdict === SheetVerdict.MISSING_SIGNATURE) {
    return (
      <Banner tone="bad">
        <CircleX className="mt-0.5 size-4 shrink-0 text-overdue" />
        <span>
          <span className="font-semibold">Not approved.</span> {missingWho(check)}. Get it signed and take the photo again.
        </span>
      </Banner>
    );
  }

  if (check.verdict === SheetVerdict.NOT_A_SHEET) {
    return (
      <Banner tone="bad">
        <CircleX className="mt-0.5 size-4 shrink-0 text-overdue" />
        <span>
          <span className="font-semibold">Not approved.</span> This doesn't look like the handover sheet. Take a photo of the printed, signed sheet.
        </span>
      </Banner>
    );
  }

  return (
    <Banner tone="warn">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
      <span>
        <span className="font-semibold">Couldn't confirm both signatures.</span> {check.note} Check them yourself before submitting.
      </span>
    </Banner>
  );
}

function SheetCheckBanner({ state, parcels }: { state: SheetCheckState; parcels: number }) {
  if (state.status === 'checking') {
    return (
      <Banner tone="ok">
        <Spinner className="mt-0.5 size-4" />
        Smart check: reading the signed sheet…
      </Banner>
    );
  }

  if (state.status === 'failed') {
    return (
      <Banner tone="warn">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
        <span>Couldn't check the sheet ({state.message}). Check both signatures yourself before submitting.</span>
      </Banner>
    );
  }

  if (!state.response.check) {
    return (
      <Banner tone="warn">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
        <span>{state.response.note ?? 'The smart check is off.'} Check both signatures yourself before submitting.</span>
      </Banner>
    );
  }

  return <CheckOutcome check={state.response.check} parcels={parcels} />;
}

/**
 * The AI reads the signed sheet. Both boxes signed approves it; a clearly
 * unsigned box or another document holds the handover back. When the AI can't
 * tell or isn't available, the person checks and may still submit.
 */
function SheetCheckPanel({
  photo,
  parcels,
  courier,
  onChecked,
}: {
  photo: string;
  parcels: number;
  courier: string;
  onChecked: (allowed: boolean) => void;
}) {
  const [state, setState] = useState<SheetCheckState>({ status: 'checking' });

  useEffect(() => {
    let current = true;

    function settle(next: SheetCheckState) {
      if (!current) {
        return;
      }

      setState(next);

      onChecked(allowsSubmit(next));
    }

    api
      .checkSheet({ sheet: photo, parcels, courier })
      .then(response => settle({ status: 'done', response }))
      .catch((error: Error) => settle({ status: 'failed', message: error.message }));

    return () => {
      current = false;
    };
  }, [photo, parcels, courier, onChecked]);

  return <SheetCheckBanner state={state} parcels={parcels} />;
}

function SheetCheckFor({
  photo,
  parcels,
  courier,
  onChecked,
}: {
  photo: string | null;
  parcels: number;
  courier: string;
  onChecked: (allowed: boolean) => void;
}) {
  if (!photo) {
    return null;
  }

  // A new upload restarts the check.
  return <SheetCheckPanel key={photo} photo={photo} parcels={parcels} courier={courier} onChecked={onChecked} />;
}

interface SheetPhotoProps {
  photo: string | null;
  parcels: number;
  courier: string;
  onPhoto: (photo: string) => void;
  onChecked: (allowed: boolean) => void;
}

function SheetPhoto({ photo, parcels, courier, onPhoto, onChecked }: SheetPhotoProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <PhotoPicker onPhoto={onPhoto} cameraTitle="Photo of the signed handover sheet" allowPdf />

        <SheetThumb photo={photo} />
      </div>

      <SheetCheckFor photo={photo} parcels={parcels} courier={courier} onChecked={onChecked} />
    </div>
  );
}

function SheetThumb({ photo }: { photo: string | null }) {
  if (!photo) {
    return null;
  }

  if (photo.startsWith('data:application/pdf')) {
    return (
      <span className="flex h-16 items-center gap-1.5 rounded border px-3 text-sm">
        <FileText className="size-5 text-overdue" />
        PDF attached
      </span>
    );
  }

  return <img src={photo} alt="Signed handover sheet" className="h-16 rounded border object-cover" />;
}

/** Words that differ between taking returns in and handing parcels out. */
const COPY: Record<BatchKind, { scanned: string; submitted: string }> = {
  [BatchKind.RECEIVE]: {
    scanned: 'parcels scanned',
    submitted: 'parcels from',
  },
  [BatchKind.DISPATCH]: {
    scanned: 'parcels cleared to go',
    submitted: 'parcels handed to',
  },
};

interface HandoverProps {
  kind: BatchKind;
  batch: BatchStart;
  /** Parcels on the sheet: scanned in (receiving) or cleared to go (dispatch). */
  count: number;
  /** The printable sheet for this handover, given the rider's count. */
  renderSheet: (courierCount: number | null) => ReactNode;
}

function FinishDialog({
  kind,
  batch,
  count,
  renderSheet,
  open,
  onOpenChange,
}: HandoverProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { submitBatch } = useDesk();

  const [printed, setPrinted] = useState(false);

  const [photo, setPhoto] = useState<string | null>(null);

  // Submit waits for the sheet check: allowed unless it found a missing signature or another document.
  const [approved, setApproved] = useState(false);

  function onSheet(next: string) {
    setPhoto(next);

    setApproved(false);
  }

  const [submitting, setSubmitting] = useState(false);

  const copy = COPY[kind];

  function print() {
    setPrinted(true);

    window.print();
  }

  async function submit() {
    if (!photo || !approved) {
      return;
    }

    setSubmitting(true);

    try {
      // The rider's count isn't asked for: the parcels on the sheet stand for it.
      await submitBatch(kind, { courierCount: count, signedSheet: photo });

      toast.success(`Handover submitted: ${formatCount(count)} ${copy.submitted} ${batch.courier}`);

      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Finish this handover</DialogTitle>

          <DialogDescription>
            {batch.courier} · {formatCount(count)} {copy.scanned}. The batch is submitted once the signed sheet is uploaded.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <Step n={1} title="Print the handover sheet and get it signed by you and the rider" done={printed}>
            <Button variant="outline" size="sm" className="self-start" onClick={print}>
              <Printer />
              Print sheet
            </Button>
          </Step>

          <Step n={2} title="Take a photo of the signed sheet, or upload a scan (photo or PDF)" done={approved}>
            <SheetPhoto photo={photo} parcels={count} courier={batch.courier} onPhoto={onSheet} onChecked={setApproved} />
          </Step>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Keep scanning
          </Button>

          <Button onClick={() => void submit()} disabled={!photo || !approved || submitting}>
            Submit handover
          </Button>
        </div>

        {renderSheet(null)}
      </DialogContent>
    </Dialog>
  );
}

/** What starting fresh costs, in the words of this kind of handover. */
function discardWarning(kind: BatchKind, count: number): string {
  const ask = 'You will be asked for the courier and vehicle number again.';

  if (count === 0 && kind === BatchKind.DISPATCH) {
    return `No parcels are cleared to go yet; any checks made so far are dropped. ${ask}`;
  }

  if (count === 0) {
    return `No parcels are in this handover yet; anything set aside from it is dropped too. ${ask}`;
  }

  if (kind === BatchKind.DISPATCH) {
    return `The ${formatCount(count)} parcels checked so far are taken off this pickup, and it is not recorded. ${ask}`;
  }

  return `The ${formatCount(count)} parcels scanned so far are taken back (they go back to expected), and this handover is not recorded. ${ask}`;
}

function StartFreshDialog({
  kind,
  count,
  beforeDiscard,
  open,
  onOpenChange,
}: {
  kind: BatchKind;
  count: number;
  beforeDiscard?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { discardBatch } = useDesk();

  const [working, setWorking] = useState(false);

  async function startFresh() {
    setWorking(true);

    try {
      beforeDiscard?.();

      await discardBatch(kind);

      toast.success('Handover discarded. Start a new one.');

      onOpenChange(false);
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start fresh?</DialogTitle>

          <DialogDescription>{discardWarning(kind, count)}</DialogDescription>
        </DialogHeader>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Keep this handover
          </Button>

          <Button variant="destructive" onClick={() => void startFresh()} disabled={working}>
            Start fresh
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Who, which courier, how many so far; and the way to close it, or to give it up and start over.
 * `extra`: tallies and sync status, shown before the buttons.
 * `beforeDiscard`: anything this screen keeps for the handover, cleared when it is given up.
 */
export function BatchBar({ extra, beforeDiscard, ...handover }: HandoverProps & { extra?: ReactNode; beforeDiscard?: () => void }) {
  const { batch, count } = handover;

  const [finishing, setFinishing] = useState(false);

  const [startingFresh, setStartingFresh] = useState(false);

  const vehicle = batch.vehicleNo ? ` · ${batch.vehicleNo}` : '';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/40 px-4 py-2.5">
      <div className="flex items-center gap-3 text-sm">
        <Truck className="size-5 text-muted-foreground" />

        <span>
          <span className="font-medium">{batch.courier}</span>
          <span className="text-muted-foreground">
            {vehicle} · {batch.scannedBy} · since {startTime.format(new Date(batch.startedAt))}
          </span>
        </span>

        <span className="rounded-md bg-background px-2 py-0.5 font-mono text-sm font-semibold tabular-nums">{formatCount(count)} parcels</span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {extra}

        <Button size="sm" variant="outline" onClick={() => setStartingFresh(true)}>
          <RotateCcw />
          Start fresh
        </Button>

        <Button size="sm" onClick={() => setFinishing(true)} disabled={count === 0}>
          Finish handover
        </Button>
      </div>

      <StartFreshDialog kind={handover.kind} count={count} beforeDiscard={beforeDiscard} open={startingFresh} onOpenChange={setStartingFresh} />

      <FinishDialog {...handover} open={finishing} onOpenChange={setFinishing} />
    </div>
  );
}
