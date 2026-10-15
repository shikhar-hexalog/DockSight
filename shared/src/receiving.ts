// The receiving desk: scanning parcels as they're unloaded, replacing the
// Google Sheet. The same classifyScan() runs at the desk (instant answer,
// even offline) and on the server (the stored answer).

import type { ParcelCondition } from './batches.ts';
import { type ReturnType, Stage } from './constants.ts';

/** What a scan turned out to be. */
export const ScanResult = {
  /** An expected return, now received. */
  MATCHED: 'MATCHED',
  /** Already scanned at the dock before: a second scan of the same parcel. */
  ALREADY_RECEIVED: 'ALREADY_RECEIVED',
  /** Uniware has already processed it; nothing to do. */
  ALREADY_PROCESSED: 'ALREADY_PROCESSED',
  /** Uniware cancelled this return, but the parcel came anyway. */
  CANCELLED_RETURN: 'CANCELLED_RETURN',
  /** No return in Uniware matches this code. */
  UNEXPECTED: 'UNEXPECTED',
} as const;

export type ScanResult = (typeof ScanResult)[keyof typeof ScanResult];

/** Results that need someone to act: they go to the exceptions list. */
export const EXCEPTION_RESULTS: ScanResult[] = [ScanResult.CANCELLED_RETURN, ScanResult.UNEXPECTED];

export const SCAN_RESULT_LABEL: Record<ScanResult, string> = {
  [ScanResult.MATCHED]: 'Received',
  [ScanResult.ALREADY_RECEIVED]: 'Already scanned',
  [ScanResult.ALREADY_PROCESSED]: 'Already processed in Uniware',
  [ScanResult.CANCELLED_RETURN]: 'Return was cancelled',
  [ScanResult.UNEXPECTED]: 'Not an expected return',
};

/** One scan at the desk, as sent to the server. */
export interface ReceiveScan {
  /** Made at the desk; the server stores each id once, so retries are safe. */
  id: string;
  code: string;
  scannedBy: string;
  /** Desk clock when it was scanned, which may be before it reached the server. */
  scannedAt: string;
  /** The receiving batch (courier handover) it was scanned in. */
  batchId?: string;
}

/** An expected return as the desk keeps it, for matching scans offline. */
export interface DeskReturn {
  id: string;
  type: ReturnType;
  sourceCode: string;
  stage: Stage;
  courier: string | null;
  saleOrderCode: string | null;
  reversePickupCode: string | null;
  trackingNumber: string | null;
  itemCount: number;
  firstItemName: string | null;
  dockReceivedAt: string | null;
  dockReceivedBy: string | null;
  /** Every code a scanner might read for this return. */
  codes: string[];
}

export interface DeskManifest {
  generatedAt: string;
  returns: DeskReturn[];
}

/** A stored scan, with what it matched. */
export interface Receipt {
  id: string;
  code: string;
  result: ScanResult;
  returnId: string | null;
  type: ReturnType | null;
  sourceCode: string | null;
  courier: string | null;
  saleOrderCode: string | null;
  reversePickupCode: string | null;
  firstItemName: string | null;
  scannedBy: string;
  scannedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  batchId: string | null;
  condition: ParcelCondition | null;
  conditionNote: string | null;
  conditionPhotoUrl: string | null;
}

export interface ReceiveResponse {
  results: Receipt[];
}

export interface ReceiptsResponse {
  data: Receipt[];
}

/** Codes are matched without spaces or case, the way scanners and typists differ. */
export function normalizeCode(code: string): string {
  return code.replace(/\s+/g, '').toUpperCase();
}

/** Decides what a scan means, given the return it matched (if any). */
export function classifyScan(match: Pick<DeskReturn, 'stage' | 'dockReceivedAt'> | null): ScanResult {
  if (!match) {
    return ScanResult.UNEXPECTED;
  }

  if (match.stage === Stage.PROCESSED) {
    return ScanResult.ALREADY_PROCESSED;
  }

  // Checked before "cancelled" so a second scan of a cancelled parcel doesn't
  // raise a second exception.
  if (match.dockReceivedAt) {
    return ScanResult.ALREADY_RECEIVED;
  }

  if (match.stage === Stage.CANCELLED) {
    return ScanResult.CANCELLED_RETURN;
  }

  return ScanResult.MATCHED;
}
