// A thumbnail that opens full size in a dialog when clicked.

import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

export function ZoomableImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Zoom in: ${alt}`}
          className="flex shrink-0 cursor-zoom-in rounded-md focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <img src={src} alt={alt} className={className} />
        </button>
      </DialogTrigger>

      <DialogContent aria-describedby={undefined} className="w-fit gap-2 p-2 sm:max-w-3xl">
        <DialogTitle className="sr-only">{alt}</DialogTitle>

        <img src={src} alt={alt} className="max-h-[85vh] max-w-full rounded-lg object-contain" />
      </DialogContent>
    </Dialog>
  );
}
