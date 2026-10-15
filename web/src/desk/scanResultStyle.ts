import { CircleCheck, CircleSlash, type LucideIcon, PackageX, Repeat, Ban } from 'lucide-react';

import { ScanResult } from '@hexabuild/shared';

export interface ResultStyle {
  icon: LucideIcon;
  /** Card background and border. */
  card: string;
  /** Icon and badge text colour. */
  text: string;
  /** What the person at the desk should do. */
  instruction: string;
}

export const RESULT_STYLE: Record<ScanResult, ResultStyle> = {
  [ScanResult.MATCHED]: {
    icon: CircleCheck,
    card: 'border-ok/40 bg-ok/10',
    text: 'text-ok',
    instruction: 'Received. Move it to the processing area.',
  },
  [ScanResult.ALREADY_RECEIVED]: {
    icon: Repeat,
    card: 'border-border bg-muted',
    text: 'text-muted-foreground',
    instruction: 'Already scanned. Nothing to do.',
  },
  [ScanResult.ALREADY_PROCESSED]: {
    icon: CircleSlash,
    card: 'border-border bg-muted',
    text: 'text-muted-foreground',
    instruction: 'Uniware has already processed this return. Check why the parcel is here again.',
  },
  [ScanResult.CANCELLED_RETURN]: {
    icon: Ban,
    card: 'border-overdue/40 bg-overdue/10',
    text: 'text-overdue',
    instruction: 'Return was cancelled in Uniware. Keep it aside; the reverse pickup must be recreated.',
  },
  [ScanResult.UNEXPECTED]: {
    icon: PackageX,
    card: 'border-border bg-muted/50',
    text: 'text-foreground',
    instruction: 'This parcel is not in the expected list. Keep it aside for review.',
  },
};
