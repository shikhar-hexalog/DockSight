import { type ReactNode, useRef, useState } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * A label that explains itself, without an (i) icon beside it: hover with a
 * mouse, Tab to it with a keyboard, or tap it on a touch screen.
 */
export function Explained({ text, children }: { text: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  // Tooltips ignore taps, so a tap opens it by hand (tapping elsewhere closes it).
  const touch = useRef(false);

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          onPointerDown={event => {
            touch.current = event.pointerType === 'touch';
          }}
          onClick={event => {
            if (!touch.current) {
              return;
            }

            // Inside a link: explain, don't navigate.
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
          }}
          className="cursor-help rounded-[2px] outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
        >
          {children}
        </span>
      </TooltipTrigger>

      <TooltipContent className="max-w-xs text-xs leading-relaxed">{text}</TooltipContent>
    </Tooltip>
  );
}
