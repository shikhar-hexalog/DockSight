// Two ways to add a photo: take one with the camera (webcam on the desk
// computer, back camera on a phone), or upload a file that's already there.
// On a desktop, <input capture> just opens a file picker, so "Take photo"
// opens its own camera window instead.

import { Camera, RefreshCw, Upload } from 'lucide-react';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { compressImage } from './compressImage';

const MAX_SIDE = 1600;

const QUALITY = 0.72;

function frameToJpeg(video: HTMLVideoElement): string {
  const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));

  const canvas = document.createElement('canvas');

  canvas.width = Math.round(video.videoWidth * scale);

  canvas.height = Math.round(video.videoHeight * scale);

  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL('image/jpeg', QUALITY);
}

function CameraBody({ shot, error, videoRef }: { shot: string | null; error: string | null; videoRef: React.RefObject<HTMLVideoElement | null> }) {
  if (error) {
    return <p className="rounded-lg border border-overdue/40 bg-overdue/5 p-4 text-sm text-overdue">{error}</p>;
  }

  if (shot) {
    return <img src={shot} alt="Captured" className="w-full rounded-lg border" />;
  }

  return <video ref={videoRef} muted playsInline className="aspect-[4/3] w-full rounded-lg bg-black object-cover" />;
}

function CameraActions({
  shot,
  ready,
  onCapture,
  onRetake,
  onUse,
}: {
  shot: string | null;
  ready: boolean;
  onCapture: () => void;
  onRetake: () => void;
  onUse: () => void;
}) {
  if (shot) {
    return (
      <>
        <Button variant="outline" onClick={onRetake}>
          <RefreshCw />
          Retake
        </Button>

        <Button onClick={onUse}>Use this photo</Button>
      </>
    );
  }

  return (
    <Button onClick={onCapture} disabled={!ready}>
      <Camera />
      Capture
    </Button>
  );
}

function CameraDialog({ open, title, onClose, onPhoto }: { open: boolean; title: string; onClose: () => void; onPhoto: (photo: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const streamRef = useRef<MediaStream | null>(null);

  const [ready, setReady] = useState(false);

  const [shot, setShot] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || shot) {
      return;
    }

    let cancelled = false;

    async function start() {
      setReady(false);

      setError(null);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });

        if (cancelled) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        streamRef.current = stream;

        const video = videoRef.current;

        if (video) {
          video.srcObject = stream;
          await video.play();
          setReady(true);
        }
      } catch {
        setError('No camera available here, or camera access was blocked. Use "Upload photo" instead.');
      }
    }

    void start();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    };
  }, [open, shot]);

  function close() {
    setShot(null);

    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={next => !next && close()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>

          <DialogDescription>Hold it steady and make sure it's sharp and well lit.</DialogDescription>
        </DialogHeader>

        <CameraBody shot={shot} error={error} videoRef={videoRef} />

        <div className="flex justify-end gap-2">
          <CameraActions
            shot={shot}
            ready={ready}
            onCapture={() => videoRef.current && setShot(frameToJpeg(videoRef.current))}
            onRetake={() => setShot(null)}
            onUse={() => {
              if (shot) {
                onPhoto(shot);
              }

              close();
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

const PDF_TYPE = 'application/pdf';

// Every PDF starts with these bytes.
const PDF_MAGIC = '%PDF-';

// Same limit as the server; PDFs aren't shrunk the way photos are.
const MAX_PDF_BYTES = 8 * 1024 * 1024;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result));

    reader.onerror = () => reject(reader.error);

    reader.readAsDataURL(file);
  });
}

interface PhotoPickerProps {
  /** A JPEG data URL, or a PDF data URL when allowPdf is on. */
  onPhoto: (photo: string) => void;
  /** Title of the camera window. */
  cameraTitle: string;
  size?: 'sm' | 'default';
  /** Also accept a PDF upload (scanned documents, e.g. a signed sheet). */
  allowPdf?: boolean;
}

export function PhotoPicker({ onPhoto, cameraTitle, size = 'sm', allowPdf = false }: PhotoPickerProps) {
  const [cameraOpen, setCameraOpen] = useState(false);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    event.target.value = '';

    if (!file) {
      return;
    }

    if (allowPdf && file.type === PDF_TYPE) {
      if (file.size > MAX_PDF_BYTES) {
        toast.error('That PDF is larger than 8 MB. Scan it at a lower quality, or take a photo instead.');
        return;
      }

      // The same check the server makes, so a bad file is caught here and not after submitting.
      if ((await file.slice(0, PDF_MAGIC.length).text()) !== PDF_MAGIC) {
        toast.error("That file isn't a readable PDF. Try exporting it again, or take a photo instead.");
        return;
      }

      onPhoto(await readAsDataUrl(file));
      return;
    }

    try {
      onPhoto(await compressImage(file));
    } catch {
      toast.error("Couldn't read that file. Try a photo (JPEG or PNG)" + (allowPdf ? ' or a PDF.' : '.'));
    }
  }

  return (
    <div className="flex gap-2">
      <Button type="button" variant="outline" size={size} onClick={() => setCameraOpen(true)}>
        <Camera />
        Take photo
      </Button>

      <Button type="button" variant="outline" size={size} asChild>
        <label className="cursor-pointer">
          <Upload />
          {allowPdf ? 'Upload photo or PDF' : 'Upload photo'}
          <input type="file" accept={allowPdf ? `image/*,${PDF_TYPE}` : 'image/*'} onChange={e => void onFile(e)} className="sr-only" />
        </label>
      </Button>

      <CameraDialog open={cameraOpen} title={cameraTitle} onClose={() => setCameraOpen(false)} onPhoto={onPhoto} />
    </div>
  );
}
