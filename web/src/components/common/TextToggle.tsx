// A choice between a few words: the chosen one in ink, the rest muted.

import { cn } from '@/lib/utils';

interface TextToggleProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}

export function TextToggle<T extends string>({ options, value, onChange, label, className }: TextToggleProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex items-baseline gap-3 text-[13px]', className)}>
      {options.map(option => {
        const on = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
              on ? 'font-semibold text-ink' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
