// Phone as a wireless scanner: the phone reads barcodes with its camera and
// the laptop screen it's paired with treats each one exactly like a scan
// from the USB barcode gun. The laptop sends the outcome back to the phone.

import type { HandoverResult } from './dispatch.ts';
import type { ScanResult } from './receiving.ts';
import type { QcLookupResult } from './workflow.ts';

/** Which laptop screen the phone is scanning for. */
export const RemoteTarget = {
  RECEIVE: 'receive',
  DISPATCH: 'dispatch',
  QC: 'qc',
} as const;

export type RemoteTarget = (typeof RemoteTarget)[keyof typeof RemoteTarget];

export const REMOTE_TARGET_LABEL: Record<RemoteTarget, string> = {
  [RemoteTarget.RECEIVE]: 'Receive returns',
  [RemoteTarget.DISPATCH]: 'Dispatch handover check',
  [RemoteTarget.QC]: 'QC station',
};

/** Anything a laptop screen can report back for a scan. */
export type RemoteOutcome = ScanResult | HandoverResult | QcLookupResult;

export interface RemoteSession {
  id: string;
  target: RemoteTarget;
  /** Opens the scanner on the phone; shown to it as a QR code. */
  phoneUrl: string;
}

/** Server-sent events on a session. */
export const RemoteEvent = {
  /** To the laptop: the phone opened the scanner. */
  PHONE_JOINED: 'phone-joined',
  /** To the laptop: a code the phone read. */
  SCAN: 'scan',
  /** To the phone: what the laptop made of a scan. */
  RESULT: 'result',
} as const;

export type RemoteEvent = (typeof RemoteEvent)[keyof typeof RemoteEvent];

export const RemoteRole = {
  LAPTOP: 'laptop',
  PHONE: 'phone',
} as const;

export type RemoteRole = (typeof RemoteRole)[keyof typeof RemoteRole];

export interface RemoteScan {
  id: string;
  code: string;
}

export interface RemoteResult {
  scanId: string;
  code: string;
  outcome: RemoteOutcome;
}

export interface RemoteJoinResponse {
  target: RemoteTarget;
  laptopConnected: boolean;
}

export interface RemoteScanResponse {
  delivered: boolean;
}

/** How the phone shows each outcome: a short label and whether it's good news. */
export const OutcomeTone = {
  GOOD: 'good',
  REPEAT: 'repeat',
  BAD: 'bad',
} as const;

export type OutcomeTone = (typeof OutcomeTone)[keyof typeof OutcomeTone];

export const REMOTE_OUTCOME: Record<RemoteOutcome, { label: string; tone: OutcomeTone }> = {
  MATCHED: { label: 'Received', tone: OutcomeTone.GOOD },
  ALREADY_RECEIVED: { label: 'Already scanned', tone: OutcomeTone.REPEAT },
  ALREADY_PROCESSED: { label: 'Already processed in Uniware', tone: OutcomeTone.REPEAT },
  CANCELLED_RETURN: { label: 'Return was cancelled: set aside', tone: OutcomeTone.BAD },
  UNEXPECTED: { label: 'Not expected: set aside', tone: OutcomeTone.BAD },
  STOP: { label: 'STOP: do not hand over', tone: OutcomeTone.BAD },
  CLEAR: { label: 'OK to hand over', tone: OutcomeTone.GOOD },
  ALREADY_PULLED: { label: 'Already pulled out', tone: OutcomeTone.REPEAT },
  INVALID: { label: "Couldn't check", tone: OutcomeTone.BAD },
  NOT_FOUND: { label: 'No return with this code', tone: OutcomeTone.BAD },
  FOUND: { label: 'Opened on the QC screen', tone: OutcomeTone.GOOD },
};
