// After the dock: return manifests and QC.
// - A manifest (received parcels grouped per courier, as Uniware's Returns ->
//   Manifest screen does) is made from each submitted receiving handover: no
//   second scan.
// - QC starts with an AI product check (photo vs the catalogue images: same
//   product, colour, print?). A mismatch is graded wrong item straight away;
//   a match goes on to the person's condition check.
// Both are recorded in this app; Uniware is not written to. The Uniware call
// QC would make is kept as a dry run so it can be checked first.

import type { ReturnItem } from './api.ts';
import type { ReturnType, Stage } from './constants.ts';

export const ManifestStatus = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
} as const;

export type ManifestStatus = (typeof ManifestStatus)[keyof typeof ManifestStatus];

export interface ReturnManifest {
  id: string;
  courier: string;
  createdBy: string;
  createdAt: string;
  status: ManifestStatus;
  closedAt: string | null;
  closedBy: string | null;
  count: number;
}

export interface ManifestParcel {
  returnId: string;
  code: string;
  sourceCode: string;
  saleOrderCode: string | null;
  courier: string | null;
  firstItemName: string | null;
  itemCount: number;
  addedAt: string;
  qcDone: boolean;
}

export interface ManifestsResponse {
  data: ReturnManifest[];
}

export interface ManifestDetailResponse {
  manifest: ReturnManifest;
  parcels: ManifestParcel[];
}

/** Uniware's inventory types, used as-is so the dry-run payload is exactly what would be sent. */
export const QcGrade = {
  GOOD: 'GOOD_INVENTORY',
  BAD: 'BAD_INVENTORY',
} as const;

export type QcGrade = (typeof QcGrade)[keyof typeof QcGrade];

/** Where an item goes when no shelf was scanned: the good or bad inventory area. */
export const DEFAULT_SHELF: Record<QcGrade, string> = {
  [QcGrade.GOOD]: 'GOOD-INVENTORY',
  [QcGrade.BAD]: 'BAD-INVENTORY',
};

/** The scanned shelf, or the default one for the item's grade. */
export const shelfFor = (shelfCode: string | null, grade: QcGrade) => shelfCode || DEFAULT_SHELF[grade];

/** One label for the whole parcel: the scanned shelf, or each default area used. */
export const parcelShelf = (shelfCode: string | null, grades: QcGrade[]) =>
  shelfCode || [...new Set(grades.map(grade => DEFAULT_SHELF[grade]))].join(' / ');

export const QC_GRADE_LABEL: Record<QcGrade, string> = {
  [QcGrade.GOOD]: 'Good',
  [QcGrade.BAD]: 'Bad',
};

export const QcReason = {
  DAMAGED: 'DAMAGED',
  USED: 'USED',
  WRONG_ITEM: 'WRONG_ITEM',
  MISSING_PARTS: 'MISSING_PARTS',
  EMPTY_BOX: 'EMPTY_BOX',
  TAG_REMOVED: 'TAG_REMOVED',
} as const;

export type QcReason = (typeof QcReason)[keyof typeof QcReason];

export const QC_REASONS: QcReason[] = [
  QcReason.DAMAGED,
  QcReason.USED,
  QcReason.WRONG_ITEM,
  QcReason.MISSING_PARTS,
  QcReason.EMPTY_BOX,
  QcReason.TAG_REMOVED,
];

export const QC_REASON_LABEL: Record<QcReason, string> = {
  [QcReason.DAMAGED]: 'Damaged',
  [QcReason.USED]: 'Used / worn',
  [QcReason.WRONG_ITEM]: 'Wrong item',
  [QcReason.MISSING_PARTS]: 'Missing parts',
  [QcReason.EMPTY_BOX]: 'Empty box',
  [QcReason.TAG_REMOVED]: 'Tags removed',
};

export interface QcItemInput {
  /** Uniware's sale order item code. */
  code: string;
  grade: QcGrade;
  reason: QcReason | null;
}

export interface QcSubmit {
  returnId: string;
  qcBy: string;
  /** Null when no shelf was scanned: items go to the good or bad inventory area. */
  shelfCode: string | null;
  items: QcItemInput[];
  /** Data URL of a photo of the product. */
  photo: string | null;
  /** The AI product check, kept to compare with what the person chose. */
  aiCheck: QcMatchCheck | null;
}

/** Exactly the body of Uniware's POST /oms/returns/complete, not sent. */
export interface UniwareQcPayload {
  saleOrderCode: string;
  saleOrderItems: { code: string; status: QcGrade; shelfCode: string; reason?: string }[];
}

export interface QcItemRecord extends QcItemInput {
  itemName: string | null;
  skuCode: string | null;
}

export interface QcRecord {
  id: string;
  returnId: string;
  qcBy: string;
  qcAt: string;
  shelfCode: string;
  photoUrl: string | null;
  items: QcItemRecord[];
  aiCheck: QcMatchCheck | null;
  uniwarePayload: UniwareQcPayload;
  /** Null while the Uniware push is off: recorded here only. */
  pushedAt: string | null;
}

export const QcLookupResult = {
  FOUND: 'FOUND',
  NOT_FOUND: 'NOT_FOUND',
} as const;

export type QcLookupResult = (typeof QcLookupResult)[keyof typeof QcLookupResult];

export interface QcReturn {
  id: string;
  type: ReturnType;
  stage: Stage;
  sourceCode: string;
  saleOrderCode: string | null;
  courier: string | null;
  dockReceivedAt: string | null;
  manifest: { id: string; courier: string } | null;
  items: ReturnItem[];
  qc: QcRecord | null;
}

export interface QcLookupResponse {
  result: QcLookupResult;
  code: string;
  return: QcReturn | null;
}

export interface QcRecentResponse {
  data: (QcRecord & { sourceCode: string; saleOrderCode: string | null })[];
}

export const MatchVerdict = {
  MATCH: 'MATCH',
  MISMATCH: 'MISMATCH',
  /** Photo unclear, or the item can't be seen: the person checks. */
  UNSURE: 'UNSURE',
} as const;

export type MatchVerdict = (typeof MatchVerdict)[keyof typeof MatchVerdict];

export const MATCH_VERDICT_LABEL: Record<MatchVerdict, string> = {
  [MatchVerdict.MATCH]: 'Matches',
  [MatchVerdict.MISMATCH]: 'Wrong product',
  [MatchVerdict.UNSURE]: 'Not sure',
};

export interface ItemMatch {
  /** Sale order item code. */
  code: string;
  verdict: MatchVerdict;
  /** What the catalogue shows, in a few words, e.g. "brown maxi dress". */
  expected: string;
  /** What the photo shows. */
  observed: string;
}

/** The AI's product check on one parcel photo. Only advice: the person decides. */
export interface QcMatchCheck {
  /** MISMATCH if any item is wrong, MATCH if all match, else UNSURE. */
  verdict: MatchVerdict;
  items: ItemMatch[];
  note: string;
  seconds: number;
}

export interface QcCheckRequest {
  returnId: string;
  photo: string;
}

export interface QcCheckResponse {
  check: QcMatchCheck | null;
  provider: string;
  note: string | null;
}
