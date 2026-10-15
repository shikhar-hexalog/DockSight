// Domain values shared by the server and the web app.

/** Uniware's return types. CIR = customer-initiated return, our DTO. */
export const ReturnType = {
  RTO: 'RTO',
  CIR: 'CIR',
} as const;

export type ReturnType = (typeof ReturnType)[keyof typeof ReturnType];

export const RETURN_TYPES: ReturnType[] = [ReturnType.RTO, ReturnType.CIR];

export const RETURN_TYPE_LABEL: Record<ReturnType, string> = {
  [ReturnType.RTO]: 'RTO',
  [ReturnType.CIR]: 'DTO',
};

/**
 * Where a return is, from the warehouse's point of view.
 *
 * EXPECTED   Uniware expects it; it hasn't reached the warehouse.
 * RECEIVED   It's physically here (scanned at the dock, or the courier marked
 *            it delivered) but not yet processed in Uniware. This is the gap
 *            the warehouse can't see today.
 * PROCESSED  Done in Uniware: back in inventory.
 * CANCELLED  Uniware cancelled the return (it never came in time).
 *
 * A stage never moves backwards.
 */
/**
 * Where a return is, from Uniware's status and our own dock records:
 *   EXPECTED   - Uniware: RETURN_EXPECTED, not at our dock yet
 *   RECEIVED   - "Pending in Uniware": at our dock (scan / receiving sheet), not in Uniware yet
 *   MANIFESTED - Uniware: RETURN_ACKNOWLEDGED, or returned but putaway not closed
 *   CLOSED     - putaway closed: stock back in inventory (Uniware's inventory received date)
 * CANCELLED is kept for Uniware data only; the warehouse doesn't cancel, so it isn't shown.
 */
export const Stage = {
  EXPECTED: 'EXPECTED',
  RECEIVED: 'RECEIVED',
  MANIFESTED: 'MANIFESTED',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
} as const;

export type Stage = (typeof Stage)[keyof typeof Stage];

/** The main flow, in order. Cancelled sits outside it. */
export const STAGE_ORDER: Stage[] = [Stage.EXPECTED, Stage.RECEIVED, Stage.MANIFESTED, Stage.CLOSED];

/** The stages shown on the board, filters and counts. */
export const ALL_STAGES: Stage[] = STAGE_ORDER;

export const STAGE_LABEL: Record<Stage, string> = {
  [Stage.EXPECTED]: 'Expected',
  [Stage.RECEIVED]: 'Pending in Uniware',
  [Stage.MANIFESTED]: 'Manifested',
  [Stage.CLOSED]: 'Closed (putaway)',
  [Stage.CANCELLED]: 'Cancelled',
};

/** Hours a return may sit in a stage before it counts as late. */
export const STAGE_SLA_HOURS: Record<Stage, number | null> = {
  [Stage.EXPECTED]: 14 * 24,
  [Stage.RECEIVED]: 24,
  [Stage.MANIFESTED]: null,
  [Stage.CLOSED]: null,
  [Stage.CANCELLED]: null,
};

// Cancelled ranks between expected and received: a cancelled return that
// physically turns up is still worth recording as received.
const STAGE_RANK: Record<Stage, number> = {
  [Stage.EXPECTED]: 0,
  [Stage.CANCELLED]: 1,
  [Stage.RECEIVED]: 2,
  [Stage.MANIFESTED]: 3,
  [Stage.CLOSED]: 4,
};

export function stageRank(stage: Stage): number {
  return STAGE_RANK[stage];
}

export function laterStage(a: Stage, b: Stage): Stage {
  return stageRank(a) >= stageRank(b) ? a : b;
}

/** How the warehouse learned a return had arrived. */
export const ReceivedSource = {
  /** Scanned at our receiving desk: the real arrival time. */
  DOCK: 'dock',
  /** A row in the warehouse's receiving sheet, imported. */
  SHEET: 'sheet',
} as const;

export type ReceivedSource = (typeof ReceivedSource)[keyof typeof ReceivedSource];

/** How a returns list is ordered. */
export const ReturnSort = {
  /** Longest in its current stage first: what needs attention. */
  STAGE_AGE: 'stage_age',
  /** Newest return first. */
  RECENT: 'recent',
} as const;

export type ReturnSort = (typeof ReturnSort)[keyof typeof ReturnSort];

export const UniwareMode = {
  LIVE: 'live',
  MOCK: 'mock',
  /** No live sync: data comes from Uniware export files (npm run import). */
  IMPORT: 'import',
} as const;

export type UniwareMode = (typeof UniwareMode)[keyof typeof UniwareMode];

export const SyncKind = {
  BACKFILL: 'BACKFILL',
  INCREMENTAL: 'INCREMENTAL',
  LOOKUP: 'LOOKUP',
} as const;

export type SyncKind = (typeof SyncKind)[keyof typeof SyncKind];

export const SyncStatus = {
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  PARTIAL: 'PARTIAL',
  FAILED: 'FAILED',
} as const;

export type SyncStatus = (typeof SyncStatus)[keyof typeof SyncStatus];

export const EventType = {
  IMPORTED: 'IMPORTED',
  SOURCE_UPDATED: 'SOURCE_UPDATED',
  STAGE_CHANGED: 'STAGE_CHANGED',
  RECEIVED_AT_DOCK: 'RECEIVED_AT_DOCK',
  /** A dock scan was taken back at the desk. */
  SCAN_REMOVED: 'SCAN_REMOVED',
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

export const Actor = {
  SYNC: 'sync',
} as const;
