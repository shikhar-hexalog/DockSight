// A small (i) next to a title: hover (or tap) to read what the number means.

import { Info } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export function InfoTip({ text, className }: { text: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          aria-label="What does this mean?"
          // Inside a link tile: show the explanation, don't navigate.
          onClick={event => {
            event.preventDefault();
            event.stopPropagation();
          }}
          className={cn('inline-flex shrink-0 cursor-help text-muted-foreground/70 hover:text-foreground', className)}
        >
          <Info className="size-3.5" />
        </span>
      </TooltipTrigger>

      <TooltipContent className="max-w-xs text-xs leading-relaxed">{text}</TooltipContent>
    </Tooltip>
  );
}
