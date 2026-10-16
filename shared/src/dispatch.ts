// The cancellation guard: orders cancelled after their package was put on a
// manifest, but before the courier took it. Pulling those parcels out at
// handover stops a forward trip and an RTO that would only bring them back.

/** Where a held parcel stands. */
export const HoldStatus = {
  /** Cancelled, on a manifest, not yet handed over: pull it out. */
  OPEN: 'OPEN',
  /** Pulled out before handover: an RTO avoided. */
  PULLED: 'PULLED',
  /** Uniware shows it dispatched anyway: it will come back as an RTO. */
  MISSED: 'MISSED',
} as const;

export type HoldStatus = (typeof HoldStatus)[keyof typeof HoldStatus];

export const HOLD_STATUS_LABEL: Record<HoldStatus, string> = {
  [HoldStatus.OPEN]: 'Pull out',
  [HoldStatus.PULLED]: 'Pulled out',
  [HoldStatus.MISSED]: 'Handed over anyway',
};

/** How a hold was pulled. */
export const PulledVia = {
  /** Scanned at the handover check and stopped. */
  HANDOVER_SCAN: 'handover_scan',
  /** Marked by hand from the pull list. */
  MANUAL: 'manual',
} as const;

export type PulledVia = (typeof PulledVia)[keyof typeof PulledVia];

export interface DispatchHold {
  id: string;
  account: string;
  saleOrderCode: string;
  packageCode: string;
  trackingNumber: string | null;
  manifestCode: string | null;
  courier: string | null;
  itemCount: number;
  firstItemName: string | null;
  cancellationReason: string | null;
  cancelledAt: string;
  detectedAt: string;
  status: HoldStatus;
  pulledAt: string | null;
  pulledBy: string | null;
  pulledVia: PulledVia | null;
  missedAt: string | null;
}

/** The customer emails sent for one submitted dispatch handover. */
export interface DispatchNotice {
  batchId: string;
  courier: string;
  /** Where the emails went (the demo inbox). */
  recipient: string | null;
  sent: number;
  failed: number;
  /** Why emails weren't sent, when some or all failed. */
  error: string | null;
  notifiedAt: string;
}

export interface DispatchNoticesResponse {
  data: DispatchNotice[];
  /** Where the sent emails can be seen (the sender's Sent Items in Outlook). */
  inboxUrl: string;
}

export interface DispatchHoldsResponse {
  data: DispatchHold[];
}

/** What a scan at the handover check means. */
export const HandoverResult = {
  /** No cancellation known for this parcel: hand it over. */
  CLEAR: 'CLEAR',
  /** Its order was cancelled: do not hand it over. */
  STOP: 'STOP',
  /** Already pulled out earlier; it shouldn't be in the handover pile. */
  ALREADY_PULLED: 'ALREADY_PULLED',
  /** The scan couldn't be checked. Never shown as safe. */
  INVALID: 'INVALID',
} as const;

export type HandoverResult = (typeof HandoverResult)[keyof typeof HandoverResult];

export const HANDOVER_RESULT_LABEL: Record<HandoverResult, string> = {
  [HandoverResult.CLEAR]: 'OK to hand over',
  [HandoverResult.STOP]: 'STOP: order cancelled',
  [HandoverResult.ALREADY_PULLED]: 'Already pulled out',
  [HandoverResult.INVALID]: "Couldn't check",
};

/** What a handover scan means, given the hold it matched (if any). */
export function handoverResultFor(hold: Pick<DispatchHold, 'status'> | null): HandoverResult {
  // A missed hold already left with the courier; it's not in this pile.
  if (!hold || hold.status === HoldStatus.MISSED) {
    return HandoverResult.CLEAR;
  }

  return hold.status === HoldStatus.PULLED ? HandoverResult.ALREADY_PULLED : HandoverResult.STOP;
}

export interface HandoverCheck {
  /** Made at the desk; the server stores each id once. */
  id: string;
  code: string;
  checkedBy: string;
  checkedAt: string;
  /** The dispatch handover (courier pickup) it was scanned in. */
  batchId?: string;
}

export interface HandoverCheckResult {
  id: string;
  code: string;
  result: HandoverResult;
  hold: DispatchHold | null;
}

export interface HandoverChecksResponse {
  results: HandoverCheckResult[];
}

export interface GuardStatus {
  lastRunAt: string | null;
  lastError: string | null;
  intervalMinutes: number;
}

export interface DispatchSummary {
  open: number;
  pulledToday: number;
  missedToday: number;
  guard: GuardStatus;
}
