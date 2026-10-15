import { CircleCheck, CircleSlash, type LucideIcon, PackageX, Repeat, Ban } from 'lucide-react';

import { ScanResult } from '@hexabuild/shared';

export interface ResultStyle {
  icon: LucideIcon;
  /** The last-scan block: a solid fill, with text colour to match. */
  card: string;
  /** Icon and badge text colour. */
  text: string;
  /** What the person at the desk should do. */
  instruction: string;
}

export const RESULT_STYLE: Record<ScanResult, ResultStyle> = {
  [ScanResult.MATCHED]: {
    icon: CircleCheck,
    card: 'bg-ok text-white',
    text: 'text-ok',
    instruction: 'Received. Move it to the processing area.',
  },
  [ScanResult.ALREADY_RECEIVED]: {
    icon: Repeat,
    card: 'bg-muted text-foreground',
    text: 'text-muted-foreground',
    instruction: 'Already scanned. Nothing to do.',
  },
  [ScanResult.ALREADY_PROCESSED]: {
    icon: CircleSlash,
    card: 'bg-muted text-foreground',
    text: 'text-muted-foreground',
    instruction: 'Uniware has already processed this return. Check why the parcel is here again.',
  },
  [ScanResult.CANCELLED_RETURN]: {
    icon: Ban,
    card: 'bg-overdue text-white',
    text: 'text-overdue',
    instruction: 'Return was cancelled in Uniware. Keep it aside; the reverse pickup must be recreated.',
  },
  [ScanResult.UNEXPECTED]: {
    icon: PackageX,
    card: 'bg-signal text-ink',
    text: 'text-foreground',
    instruction: 'This parcel is not in the expected list. Keep it aside for review.',
  },
};
