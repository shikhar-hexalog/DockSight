// The filter row under a page header: what to look at on the left (client,
// period, type), how to count time on the right. Downloads and status stay
// in the header.

import { Building2, CalendarDays, Clock } from 'lucide-react';
import type { ReactNode } from 'react';

import { CLOCK_MODE_LABEL, ClockMode } from '@hexabuild/shared';

import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useClients } from '@/hooks/queries';
import { useClock } from '@/hooks/useClock';
import { RANGE_PRESET_LABEL, RangePreset, type Scope } from '@/hooks/useScope';

const ALL_CLIENTS = 'all';

const CLOCK_MODES = [ClockMode.WORKING, ClockMode.ALL];

const pad = (n: number) => String(n).padStart(2, '0');

const timeOf = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** A small caption + control, so each filter says what it is. */
/** An icon (with its name and meaning on hover) and its control; no text label, to keep the row on one line. */
function Field({ icon, label, hint, children }: { icon: ReactNode; label: string; hint?: string; children: ReactNode }) {
  const hintText = hint ? `: ${hint}` : '';

  return (
    <div className="flex items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <span aria-label={label} className="flex cursor-help text-muted-foreground">
            {icon}
          </span>
        </TooltipTrigger>

        <TooltipContent className="max-w-xs text-xs leading-relaxed">
          {/* One paragraph, so the label and the hint flow as one sentence instead of two columns. */}
          <p>
            <span className="font-medium">{label}</span>
            {hintText}
          </p>
        </TooltipContent>
      </Tooltip>

      {children}
    </div>
  );
}

export function ClientFilter({ scope }: { scope: Scope }) {
  const { data } = useClients();

  const clients = data?.clients ?? [];

  return (
    <Field icon={<Building2 className="size-4" />} label="Client" hint="the brand (Uniware account) the returns belong to">
      <Select value={scope.scope.client ?? ALL_CLIENTS} onValueChange={value => scope.setClient(value === ALL_CLIENTS ? undefined : value)}>
        <SelectTrigger size="sm" className="h-8 min-w-32 text-xs">
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
    <Field icon={<CalendarDays className="size-4" />} label={label} hint={hint}>
      <Select value={scope.preset} onValueChange={value => scope.setPreset(value as RangePreset)}>
        <SelectTrigger size="sm" className="h-8 min-w-28 text-xs">
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
export function ClockFilter() {
  const { mode, setMode, schedule } = useClock();

  return (
    <Field
      icon={<Clock className="size-4" />}
      label="Count time in"
      hint={`Working hours counts only ${timeOf(schedule.startMinutes)}–${timeOf(schedule.endMinutes)} on working days, so a parcel arriving after closing starts waiting the next morning. "wd" = one working day.`}
    >
      <ToggleGroup type="single" size="sm" variant="outline" value={mode} onValueChange={value => value && setMode(value as ClockMode)}>
        {CLOCK_MODES.map(clock => (
          <ToggleGroupItem key={clock} value={clock} className="h-8 px-2.5 text-xs">
            {CLOCK_MODE_LABEL[clock]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Field>
  );
}

/** Filters on the left, view settings on the right. */
export function FilterBar({ filters, settings }: { filters: ReactNode; settings?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b bg-muted/30 px-6 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">{filters}</div>

      <div className="flex items-center gap-4">{settings}</div>
    </div>
  );
}
