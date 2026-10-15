import { X } from 'lucide-react';
import { useRef } from 'react';

import { Input } from '@/components/ui/input';
import { useSlashFocus } from '@/hooks/useSlashFocus';
import { cn } from '@/lib/utils';

export const SEARCH_PLACEHOLDER = 'Search AWB, order, SKU…';

function Clear({ value, onClear }: { value: string; onClear: () => void }) {
  if (!value) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={onClear}
      aria-label="Clear search"
      className="absolute top-1/2 right-0 -translate-y-1/2 text-muted-foreground hover:text-foreground"
    >
      <X className="size-3.5" />
    </button>
  );
}

/** Search any code someone might have. Press / anywhere to jump here. */
export function SearchBox({ value, onChange, className }: { value: string; onChange: (value: string) => void; className?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);

  useSlashFocus(inputRef);

  return (
    <div className={cn('relative w-full max-w-sm', className)}>
      <Input
        ref={inputRef}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={SEARCH_PLACEHOLDER}
        className="h-8 rounded-none border-0 border-b border-input bg-transparent px-0 pr-6 text-[13px] shadow-none focus-visible:border-ink focus-visible:ring-0 dark:bg-transparent"
      />

      <Clear value={value} onClear={() => onChange('')} />
    </div>
  );
}
