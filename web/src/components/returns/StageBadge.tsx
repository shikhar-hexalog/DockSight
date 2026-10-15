import { STAGE_LABEL, type Stage } from '@hexabuild/shared';

import { cn } from '@/lib/utils';
import { STAGE_DOT_CLASS } from '@/lib/stage';

export function StageDot({ stage, className }: { stage: Stage; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-1.5 shrink-0 rounded-full', STAGE_DOT_CLASS[stage], className)} />;
}

export function StageBadge({ stage }: { stage: Stage }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-xs font-medium text-foreground">
      <StageDot stage={stage} />

      {STAGE_LABEL[stage]}
    </span>
  );
}
