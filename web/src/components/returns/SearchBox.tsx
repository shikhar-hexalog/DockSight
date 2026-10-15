import { Search, X } from 'lucide-react';
import { useRef } from 'react';

import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { useSlashFocus } from '@/hooks/useSlashFocus';
import { cn } from '@/lib/utils';

export const SEARCH_PLACEHOLDER = 'Search AWB, order, SKU…';

function ClearOrHint({ value, onClear }: { value: string; onClear: () => void }) {
  if (value) {
    return (
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear search"
        className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    );
  }

  return <Kbd className="absolute top-1/2 right-2 -translate-y-1/2">/</Kbd>;
}

/** Search any code someone might have. Press / anywhere to jump here. */
export function SearchBox({ value, onChange, className }: { value: string; onChange: (value: string) => void; className?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);

  useSlashFocus(inputRef);

  return (
    <div className={cn('relative w-full max-w-sm', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />

      <Input
        ref={inputRef}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={SEARCH_PLACEHOLDER}
        className="h-8 pr-8 pl-8 text-[13px]"
      />

      <ClearOrHint value={value} onClear={() => onChange('')} />
    </div>
  );
}
