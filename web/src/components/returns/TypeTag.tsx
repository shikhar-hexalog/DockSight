import { RETURN_TYPE_LABEL, ReturnType } from '@hexabuild/shared';

import { cn } from '@/lib/utils';

const TYPE_CLASS: Record<ReturnType, string> = {
  [ReturnType.RTO]: 'border-foreground/15 bg-foreground/[0.04] text-foreground',
  [ReturnType.CIR]: 'border-border bg-transparent text-muted-foreground',
};

export function TypeTag({ type }: { type: ReturnType }) {
  return (
    <span
      className={cn(
        'inline-flex h-[18px] items-center rounded-[4px] border px-1 font-mono text-[10px] font-medium tracking-wide',
        TYPE_CLASS[type]
      )}
    >
      {RETURN_TYPE_LABEL[type]}
    </span>
  );
}
