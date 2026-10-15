import { ScanBarcode } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

// Scanners end a code with Enter, some with Tab.
const SUBMIT_KEYS = ['Enter', 'Tab'];

const TYPING_TAGS = ['INPUT', 'TEXTAREA', 'SELECT'];

const REFOCUS_DELAY_MS = 150;

interface ScanInputProps {
  disabled: boolean;
  onScan: (code: string) => void;
}

/**
 * The box a barcode gun types into. It keeps the cursor so the person never
 * has to click before scanning; it lets go when they're typing elsewhere.
 */
export function ScanInput({ disabled, onScan }: ScanInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const [value, setValue] = useState('');

  useEffect(() => {
    if (!disabled) {
      inputRef.current?.focus();
    }
  }, [disabled]);

  function refocusSoon() {
    setTimeout(() => {
      const active = document.activeElement;

      const typingElsewhere = active && active !== inputRef.current && TYPING_TAGS.includes(active.tagName);

      const dialogOpen = document.querySelector('[role="dialog"]');

      if (!typingElsewhere && !dialogOpen && !disabled) {
        inputRef.current?.focus();
      }
    }, REFOCUS_DELAY_MS);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!SUBMIT_KEYS.includes(event.key)) {
      return;
    }

    event.preventDefault();

    const code = value.trim();

    setValue('');

    if (code) {
      onScan(code);
    }
  }

  return (
    <label
      className={cn(
        'flex items-center gap-4 rounded-xl border-2 bg-background px-5 py-4 transition-colors focus-within:border-foreground',
        disabled && 'opacity-60'
      )}
    >
      <ScanBarcode className="size-7 shrink-0 text-muted-foreground" />

      <input
        ref={inputRef}
        value={value}
        disabled={disabled}
        onChange={event => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={refocusSoon}
        placeholder="Scan an AWB, or type it and press Enter"
        autoComplete="off"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent font-mono text-2xl tracking-tight outline-none placeholder:font-sans placeholder:text-base placeholder:tracking-normal placeholder:text-muted-foreground"
      />
    </label>
  );
}
