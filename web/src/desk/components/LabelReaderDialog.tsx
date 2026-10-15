import { Camera, ImageUp } from 'lucide-react';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';

import { type LabelCandidate, RETURN_TYPE_LABEL, STAGE_LABEL } from '@hexabuild/shared';

import { Mono } from '@/components/common/Mono';
import { QueryError } from '@/components/common/QueryError';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { useReadLabel } from '@/hooks/queries';
import { cn } from '@/lib/utils';

// Big enough for small print on a label, small enough to send quickly.
const MAX_SIDE = 1600;

const JPEG_QUALITY = 0.85;

const JPEG = 'image/jpeg';

function canvasToBase64(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL(JPEG, JPEG_QUALITY).split(',')[1];
}

function drawScaled(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));

  const canvas = document.createElement('canvas');

  canvas.width = Math.round(width * scale);

  canvas.height = Math.round(height * scale);

  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);

  return canvas;
}

/** The desk's webcam, live, with a button to take the picture. */
function WebcamCapture({ onCapture }: { onCapture: (base64: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;

    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setProblem('The camera only works when this page is opened on the computer itself (localhost). Upload a photo instead.');
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      } catch {
        setProblem('No camera available, or access was blocked. Upload a photo instead.');
        return;
      }

      if (cancelled || !videoRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      videoRef.current.srcObject = stream;

      await videoRef.current.play().catch(() => undefined);
    }

    void start();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  function capture() {
    const video = videoRef.current;

    if (!video || video.videoWidth === 0) {
      return;
    }

    onCapture(canvasToBase64(drawScaled(video, video.videoWidth, video.videoHeight)));
  }

  if (problem) {
    return <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{problem}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <video ref={videoRef} muted playsInline className="aspect-video w-full rounded-lg bg-black object-cover" />

      <Button onClick={capture}>
        <Camera />
        Take picture of the label
      </Button>
    </div>
  );
}

function UploadPhoto({ onCapture }: { onCapture: (base64: string) => void }) {
  async function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    event.target.value = '';

    if (!file) {
      return;
    }

    const bitmap = await createImageBitmap(file);

    onCapture(canvasToBase64(drawScaled(bitmap, bitmap.width, bitmap.height)));

    bitmap.close();
  }

  return (
    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-muted">
      <ImageUp className="size-4" />
      Or upload a photo of the label
      <input type="file" accept="image/*" className="hidden" onChange={e => void onChange(e)} />
    </label>
  );
}

function MatchLine({ candidate }: { candidate: LabelCandidate }) {
  if (!candidate.match) {
    return <span className="text-xs text-muted-foreground">Not an expected return</span>;
  }

  const { match } = candidate;

  return (
    <span className="text-xs text-ok">
      Expected: {RETURN_TYPE_LABEL[match.type]} {match.sourceCode} · {match.courier ?? 'courier unknown'} · {STAGE_LABEL[match.stage]}
    </span>
  );
}

function CandidateRow({ candidate, onUse }: { candidate: LabelCandidate; onUse: (code: string) => void }) {
  return (
    <li className={cn('flex items-center gap-3 rounded-md border px-3 py-2', candidate.match && 'border-ok/40 bg-ok/5')}>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline gap-2">
          <Mono className="text-[14px] font-semibold">{candidate.code}</Mono>

          <span className="text-[11px] text-muted-foreground">
            {candidate.kind} · {Math.round(candidate.confidence * 100)}% sure
          </span>
        </div>

        <MatchLine candidate={candidate} />
      </div>

      <Button size="sm" variant={candidate.match ? 'default' : 'outline'} onClick={() => onUse(candidate.code)}>
        Use this
      </Button>
    </li>
  );
}

function Results({ read, onUse }: { read: ReturnType<typeof useReadLabel>; onUse: (code: string) => void }) {
  if (read.isPending) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Reading the label, usually 20–40 seconds…
      </div>
    );
  }

  if (read.error) {
    return <QueryError error={read.error} onRetry={() => read.reset()} />;
  }

  if (!read.data) {
    return null;
  }

  if (read.data.candidates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{read.data.note ?? 'No code could be read. Try a sharper, closer photo, or type the AWB.'}</p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">Check the code against the label before using it.</p>

      <ul className="flex flex-col gap-2">
        {read.data.candidates.map(candidate => (
          <CandidateRow key={candidate.code} candidate={candidate} onUse={onUse} />
        ))}
      </ul>
    </div>
  );
}

interface LabelReaderDialogProps {
  open: boolean;
  onClose: () => void;
  onCode: (code: string) => void;
}

/** When a barcode won't scan: photograph the label and let the AI read the AWB. */
export function LabelReaderDialog({ open, onClose, onCode }: LabelReaderDialogProps) {
  const read = useReadLabel();

  function onCapture(base64: string) {
    read.mutate({ mimeType: JPEG, imageBase64: base64 });
  }

  function use(code: string) {
    read.reset();
    onCode(code);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={isOpen => {
        if (!isOpen) {
          read.reset();
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Read a damaged label</DialogTitle>

          <DialogDescription>Hold the label flat and close to the camera, with the AWB number readable.</DialogDescription>
        </DialogHeader>

        <WebcamCaptureWhenOpen open={open} onCapture={onCapture} />

        <UploadPhoto onCapture={onCapture} />

        <Results read={read} onUse={use} />
      </DialogContent>
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so the camera light goes off when it closes. */
function WebcamCaptureWhenOpen({ open, onCapture }: { open: boolean; onCapture: (base64: string) => void }) {
  if (!open) {
    return null;
  }

  return <WebcamCapture onCapture={onCapture} />;
}
