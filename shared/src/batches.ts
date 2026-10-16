// Receiving batches: one per courier handover at the dock. The worker says
// who is scanning and which delivery partner brought the load, scans every
// parcel (optionally tagging its condition), prints the handover sheet, gets
// it signed by both sides, and uploads a photo of it to submit the batch.
// Arrival is recorded at scan time; submitting locks the batch and attaches
// the proof.

/** Which side of the dock a handover is on. */
export const BatchKind = {
  /** Returns arriving from a delivery partner. */
  RECEIVE: 'RECEIVE',
  /** Outbound parcels handed to a courier for pickup. */
  DISPATCH: 'DISPATCH',
} as const;

export type BatchKind = (typeof BatchKind)[keyof typeof BatchKind];

/** What the parcel looked like when it arrived. Optional, one per scan. */
export const ParcelCondition = {
  DAMAGED: 'DAMAGED',
  TAMPERED: 'TAMPERED',
  WET: 'WET',
  WRONG_ITEM: 'WRONG_ITEM',
} as const;

export type ParcelCondition = (typeof ParcelCondition)[keyof typeof ParcelCondition];

export const PARCEL_CONDITIONS: ParcelCondition[] = [
  ParcelCondition.DAMAGED,
  ParcelCondition.TAMPERED,
  ParcelCondition.WET,
  ParcelCondition.WRONG_ITEM,
];

export const PARCEL_CONDITION_LABEL: Record<ParcelCondition, string> = {
  [ParcelCondition.DAMAGED]: 'Damaged / broken',
  [ParcelCondition.TAMPERED]: 'Opened / tampered',
  [ParcelCondition.WET]: 'Wet / spillage',
  [ParcelCondition.WRONG_ITEM]: 'Wrong / missing item',
};

export const BatchStatus = {
  /** Scanning, or waiting for the signed sheet. */
  OPEN: 'OPEN',
  /** Signed sheet uploaded: locked. */
  SUBMITTED: 'SUBMITTED',
} as const;

export type BatchStatus = (typeof BatchStatus)[keyof typeof BatchStatus];

/** An open batch older than this without a signed sheet is flagged. */
export const BATCH_UNSIGNED_WARN_HOURS = 2;

export interface BatchStart {
  /** Made at the desk, like scan ids. */
  id: string;
  /** Receiving or dispatch. (`kind` is taken by the desk op that carries it.) */
  batchKind: BatchKind;
  courier: string;
  vehicleNo: string | null;
  scannedBy: string;
  startedAt: string;
}

/** Desk actions besides scans, queued offline and sent in order after the scans. */
export const DeskOpKind = {
  BATCH_START: 'batch-start',
  CONDITION: 'condition',
  BATCH_SUBMIT: 'batch-submit',
  /** A receiving scan taken back (wrong barcode, or not part of this handover). */
  SCAN_REMOVE: 'scan-remove',
  /** A dispatch scan taken back. */
  CHECK_REMOVE: 'check-remove',
  /** A handover given up before it was signed: its scans are taken back and it never happened. */
  BATCH_DISCARD: 'batch-discard',
} as const;

export type DeskOpKind = (typeof DeskOpKind)[keyof typeof DeskOpKind];

export interface BatchStartOp extends BatchStart {
  kind: typeof DeskOpKind.BATCH_START;
  /** The op's own id is the batch id. */
}

export interface ConditionOp {
  kind: typeof DeskOpKind.CONDITION;
  id: string;
  scanId: string;
  /** null clears the tag. */
  condition: ParcelCondition | null;
  note: string | null;
  /** A JPEG data URL, or null for no photo. */
  photo: string | null;
  updatedAt: string;
}

export interface BatchSubmitOp {
  kind: typeof DeskOpKind.BATCH_SUBMIT;
  id: string;
  batchId: string;
  /** How many parcels the courier rider says they handed over. */
  courierCount: number;
  /** Photo of the signed handover sheet, as a JPEG data URL. */
  signedSheet: string;
  submittedBy: string;
  submittedAt: string;
}

export interface BatchDiscardOp {
  kind: typeof DeskOpKind.BATCH_DISCARD;
  id: string;
  batchId: string;
  discardedBy: string;
  discardedAt: string;
}

export interface ScanRemoveOp {
  kind: typeof DeskOpKind.SCAN_REMOVE | typeof DeskOpKind.CHECK_REMOVE;
  id: string;
  /** The receiving scan or handover check to take back. */
  scanId: string;
  removedBy: string;
  removedAt: string;
}

export type DeskOp = BatchStartOp | ConditionOp | BatchSubmitOp | ScanRemoveOp | BatchDiscardOp;

export interface DeskOpResult {
  id: string;
  ok: boolean;
  /** Why it failed; the desk keeps it and retries. */
  error: string | null;
}

export interface DeskOpsResponse {
  results: DeskOpResult[];
}

export interface ReceivingBatch extends BatchStart {
  status: BatchStatus;
  scannedCount: number;
  courierCount: number | null;
  conditionCounts: Record<ParcelCondition, number>;
  submittedAt: string | null;
  submittedBy: string | null;
  /** Link to the photo of the signed sheet. */
  signedSheetUrl: string | null;
}

export interface BatchesResponse {
  data: ReceivingBatch[];
}

/** One parcel on a batch, for the handover sheet and history. */
export interface BatchParcel {
  scanId: string;
  code: string;
  scannedAt: string;
  sourceCode: string | null;
  firstItemName: string | null;
  result: string;
  condition: ParcelCondition | null;
  conditionNote: string | null;
  conditionPhotoUrl: string | null;
}

export interface BatchDetailResponse {
  batch: ReceivingBatch;
  parcels: BatchParcel[];
}
