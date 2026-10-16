// The filter row under a page header: what to look at on the left (client,
// period, type), how to count time on the right. Downloads and status stay
// in the header.

import type { ReactNode } from 'react';

import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useClients } from '@/hooks/queries';
import { RANGE_PRESET_LABEL, RangePreset, type Scope } from '@/hooks/useScope';

const ALL_CLIENTS = 'all';

// A select that reads as text in the filter row, not as a boxed control.
const QUIET_TRIGGER =
  'h-7 gap-1 border-0 bg-transparent px-0 text-[13px] text-muted-foreground shadow-none hover:text-foreground data-[state=open]:text-foreground dark:bg-transparent';

/** A control with its name and meaning on hover. The control's own value says what it is ("All clients"). */
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5" title={hint ? `${label}: ${hint}` : label}>
      {children}
    </div>
  );
}

export function ClientFilter({ scope }: { scope: Scope }) {
  const { data } = useClients();

  const clients = data?.clients ?? [];

  return (
    <Field label="Client" hint="the brand (Uniware account) the returns belong to">
      <Select value={scope.scope.client ?? ALL_CLIENTS} onValueChange={value => scope.setClient(value === ALL_CLIENTS ? undefined : value)}>
        <SelectTrigger size="sm" className={QUIET_TRIGGER}>
          <SelectValue />
        </SelectTrigger>

        <SelectContent>
          <SelectItem value={ALL_CLIENTS} className="text-xs">
            All clients
          </SelectItem>

          {clients.map(client => (
            <SelectItem key={client.key} value={client.key} className="text-xs">
              {client.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function CustomDays({ scope }: { scope: Scope }) {
  if (scope.preset !== RangePreset.CUSTOM) {
    return null;
  }

  const from = scope.scope.from ?? '';

  const to = scope.scope.to ?? '';

  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="date"
        value={from}
        max={to}
        onChange={e => e.target.value && scope.setCustom(e.target.value, to)}
        className="h-8 w-[136px] text-xs"
      />

      <span className="text-xs text-muted-foreground">to</span>

      <Input
        type="date"
        value={to}
        min={from}
        onChange={e => e.target.value && scope.setCustom(from, e.target.value)}
        className="h-8 w-[136px] text-xs"
      />
    </div>
  );
}

export function DateRangeFilter({ scope, label, hint }: { scope: Scope; label: string; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <Select value={scope.preset} onValueChange={value => scope.setPreset(value as RangePreset)}>
        <SelectTrigger size="sm" className={QUIET_TRIGGER}>
          <SelectValue />
        </SelectTrigger>

        <SelectContent>
          {scope.presets.map(preset => (
            <SelectItem key={preset} value={preset} className="text-xs">
              {RANGE_PRESET_LABEL[preset]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <CustomDays scope={scope} />
    </Field>
  );
}

/** Working hours vs all hours, for every waiting time and late flag. */
export { ClockToggle as ClockFilter } from '@/components/layout/ClockToggle';

/** Filters on the left, view settings on the right. */
export function FilterBar({ filters, settings }: { filters: ReactNode; settings?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-8 pt-2 pb-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">{filters}</div>

      <div className="flex items-center gap-4">{settings}</div>
    </div>
  );
}
