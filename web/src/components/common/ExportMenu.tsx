// "Export" button with a period picker: each file downloads as a CSV that
// opens in Excel, for the chosen days.

import { Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ExportRange } from '@/lib/api';

const DAY_MS = 24 * 60 * 60 * 1000;

interface Period {
  label: string;
  range: () => ExportRange;
}

function startOfDay(daysAgo: number): Date {
  const date = new Date();

  date.setHours(0, 0, 0, 0);

  date.setDate(date.getDate() - daysAgo);

  return date;
}

/** From the start of `fromDaysAgo` up to now, or up to the start of `toDaysAgo`. */
function lastDays(fromDaysAgo: number, toDaysAgo?: number): ExportRange {
  const until = toDaysAgo === undefined ? new Date(Date.now() + DAY_MS) : startOfDay(toDaysAgo);

  return { since: startOfDay(fromDaysAgo).toISOString(), until: until.toISOString() };
}

const PERIODS: Period[] = [
  { label: 'Today', range: () => lastDays(0) },
  { label: 'Yesterday', range: () => lastDays(1, 0) },
  { label: 'Last 7 days', range: () => lastDays(6) },
  { label: 'Last 30 days', range: () => lastDays(29) },
];

export interface ExportFile {
  label: string;
  url: (range: ExportRange) => string;
}

function FileGroup({ file }: { file: ExportFile }) {
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel className="text-xs">{file.label}</DropdownMenuLabel>

      {PERIODS.map(period => (
        <DropdownMenuItem key={period.label} asChild>
          <a href={file.url(period.range())} download>
            {period.label}
          </a>
        </DropdownMenuItem>
      ))}
    </DropdownMenuGroup>
  );
}

export function ExportMenu({ files }: { files: ExportFile[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          <Download />
          Export
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-48">
        {files.map((file, index) => (
          <div key={file.label}>
            <DropdownMenuSeparator className={index === 0 ? 'hidden' : undefined} />

            <FileGroup file={file} />
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
