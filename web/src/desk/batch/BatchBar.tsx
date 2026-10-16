// The current handover at the top of the desk, and closing it:
// rider's count -> print the sheet -> both sign -> photo of it -> submit.

import { CircleCheck, FileText, Printer } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { BatchKind, type BatchStart } from '@hexabuild/shared';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { useDesk } from '@/desk/DeskProvider';
import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';

import { PhotoPicker } from './PhotoPicker';

const startTime = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section className="flex gap-3">
      <span className={cn('w-5 shrink-0 font-display text-[20px] leading-none font-semibold tabular-nums', done ? 'text-ok' : 'text-ink')}>{n}</span>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="text-[14px] font-medium text-ink">{title}</h3>

        {children}
      </div>
    </section>
  );
}

// Demo only: the sheet isn't actually read; the banner shows a check, then approves it.
const SHEET_CHECK_MS = 2_000;

function SheetCheck({ onApproved }: { onApproved: () => void }) {
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setChecking(false);

      onApproved();
    }, SHEET_CHECK_MS);

    return () => clearTimeout(timer);
  }, [onApproved]);

  if (checking) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <Spinner className="size-4" />
        Smart check: reading the signed sheet…
      </p>
    );
  }

  return (
    <p className="flex items-center gap-2 text-[13px] text-ok">
      <CircleCheck className="size-4 text-ok" />
      <span>
        <span className="font-semibold">Approved.</span> Smart check found both signatures on the sheet.
      </span>
    </p>
  );
}

function SheetPhoto({ photo, onPhoto, onApproved }: { photo: string | null; onPhoto: (photo: string) => void; onApproved: () => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <PhotoPicker onPhoto={onPhoto} cameraTitle="Photo of the signed handover sheet" allowPdf />

        <SheetThumb photo={photo} />
      </div>

      {/* A new upload restarts the check. */}
      {photo && <SheetCheck key={photo} onApproved={onApproved} />}
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

  // Submit waits for the sheet check banner to say approved.
  const [approved, setApproved] = useState(false);

  const approve = useCallback(() => setApproved(true), []);

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
            <SheetPhoto photo={photo} onPhoto={onSheet} onApproved={approve} />
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

/**
 * Who, which courier, how many so far; and the way to close it.
 * `extra`: tallies and sync status, shown before the finish button.
 */
export function BatchBar({ extra, ...handover }: HandoverProps & { extra?: ReactNode }) {
  const { batch, count } = handover;

  const [finishing, setFinishing] = useState(false);

  const vehicle = batch.vehicleNo ? ` · ${batch.vehicleNo}` : '';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink pb-3">
      <div className="flex items-baseline gap-4 text-[13.5px]">
        <span>
          <span className="font-semibold text-ink">{batch.courier}</span>
          <span className="text-muted-foreground">
            {vehicle} · {batch.scannedBy} · since {startTime.format(new Date(batch.startedAt))}
          </span>
        </span>

        <span className="text-muted-foreground">
          <span className="font-display text-[20px] font-semibold text-ink tabular-nums">{formatCount(count)}</span> parcels
        </span>
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
