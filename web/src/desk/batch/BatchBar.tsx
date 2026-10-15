// The current handover at the top of the desk, and closing it:
// rider's count -> print the sheet -> both sign -> photo of it -> submit.

import { CircleAlert, CircleCheck, FileText, Printer, Truck } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { BatchKind, type BatchStart } from '@hexabuild/shared';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useDesk } from '@/desk/DeskProvider';
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

function CountCheck({ scanned, courierCount }: { scanned: number; courierCount: number | null }) {
  if (courierCount === null) {
    return null;
  }

  const difference = scanned - courierCount;

  if (difference === 0) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-ok">
        <CircleCheck className="size-4" /> Matches the {formatCount(scanned)} scanned
      </p>
    );
  }

  const message =
    difference < 0
      ? `Short by ${formatCount(-difference)}: find the missing parcels or note it on the sheet`
      : `${formatCount(difference)} more scanned than the rider says`;

  return (
    <p className="flex items-center gap-1.5 text-sm font-medium text-overdue">
      <CircleAlert className="size-4" /> {message}
    </p>
  );
}

// Demo only: the sheet isn't actually read; the banner shows a check, then approves it.
const SHEET_CHECK_MS = 2_000;

function SheetCheck() {
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setChecking(false), SHEET_CHECK_MS);

    return () => clearTimeout(timer);
  }, []);

  if (checking) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-stage-expected/40 bg-stage-expected/5 px-3 py-2 text-sm">
        <Spinner className="size-4" />
        Smart check: reading the signed sheet…
      </p>
    );
  }

  return (
    <p className="flex items-center gap-2 rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-sm">
      <CircleCheck className="size-4 text-ok" />
      <span>
        <span className="font-semibold">Approved.</span> Smart check found both signatures on the sheet.
      </span>
    </p>
  );
}

function SheetPhoto({ photo, onPhoto }: { photo: string | null; onPhoto: (photo: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <PhotoPicker onPhoto={onPhoto} cameraTitle="Photo of the signed handover sheet" allowPdf />

        <SheetThumb photo={photo} />
      </div>

      {/* A new upload restarts the check. */}
      {photo && <SheetCheck key={photo} />}
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
const COPY: Record<BatchKind, { countQuestion: string; scanned: string; submitted: string }> = {
  [BatchKind.RECEIVE]: {
    countQuestion: 'How many parcels does the rider say they handed over?',
    scanned: 'parcels scanned',
    submitted: 'parcels from',
  },
  [BatchKind.DISPATCH]: {
    countQuestion: 'How many parcels is the rider taking, by their count?',
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

  const [countText, setCountText] = useState('');

  const [printed, setPrinted] = useState(false);

  const [photo, setPhoto] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);

  const copy = COPY[kind];

  const courierCount = countText.trim() === '' ? null : Number(countText);

  const countValid = courierCount !== null && Number.isInteger(courierCount) && courierCount >= 0;

  function print() {
    setPrinted(true);

    window.print();
  }

  async function submit() {
    if (!countValid || !photo) {
      return;
    }

    setSubmitting(true);

    try {
      await submitBatch(kind, { courierCount: courierCount!, signedSheet: photo });

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
          <Step n={1} title={copy.countQuestion} done={countValid}>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              value={countText}
              onChange={e => setCountText(e.target.value)}
              placeholder="Rider's count"
              className="h-9 w-40"
              autoFocus
            />

            <CountCheck scanned={count} courierCount={countValid ? courierCount : null} />
          </Step>

          <Step n={2} title="Print the handover sheet and get it signed by you and the rider" done={printed}>
            <Button variant="outline" size="sm" className="self-start" onClick={print} disabled={!countValid}>
              <Printer />
              Print sheet
            </Button>
          </Step>

          <Step n={3} title="Take a photo of the signed sheet, or upload a scan (photo or PDF)" done={photo !== null}>
            <SheetPhoto photo={photo} onPhoto={setPhoto} />
          </Step>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Keep scanning
          </Button>

          <Button onClick={() => void submit()} disabled={!countValid || !photo || submitting}>
            Submit handover
          </Button>
        </div>

        {renderSheet(countValid ? courierCount : null)}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Who, which courier, how many so far; and the way to close it.
 * `extra`: tallies and sync status, shown before the finish button.
 */
export function BatchBar({ extra, ...handover }: HandoverProps & { extra?: ReactNode }) {
  const { batch, count } = handover;

  const [finishing, setFinishing] = useState(false);

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

        <Button size="sm" onClick={() => setFinishing(true)} disabled={count === 0}>
          Finish handover
        </Button>
      </div>

      <FinishDialog {...handover} open={finishing} onOpenChange={setFinishing} />
    </div>
  );
}
