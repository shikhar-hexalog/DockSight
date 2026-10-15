// Shapes of the HTTP API, shared by the server and the web app.

import type { ParcelCondition } from './batches.ts';
import type { TimeLeg } from './timeBreakdown.ts';
import type { EventType, ReceivedSource, ReturnType, Stage, SyncKind, SyncStatus, UniwareMode } from './constants.ts';
import type { DispatchSummary } from './dispatch.ts';
import type { ClockMode, WorkSchedule } from './workingTime.ts';

export interface ReturnSummary {
  id: string;
  type: ReturnType;
  sourceCode: string;
  sourceStatus: string | null;
  stage: Stage;
  stageChangedAt: string;
  saleOrderCode: string | null;
  courier: string | null;
  trackingNumber: string | null;
  rtoReason: string | null;
  itemCount: number;
  firstItemName: string | null;
  firstReason: string | null;
  sourceCreatedAt: string | null;
  /** Courier's delivery date, from Uniware. */
  deliveredAt: string | null;
  /** First scan at our receiving desk. */
  dockReceivedAt: string | null;
  dockReceivedBy: string | null;
  /** When it reached the warehouse: the dock scan, else the courier's date. */
  receivedAt: string | null;
  receivedSource: ReceivedSource | null;
  /** When Uniware finished processing it. */
  processedAt: string | null;
  inventoryReceivedAt: string | null;
  completedAt: string | null;
}

export interface ReturnItem {
  id: string;
  saleOrderItemCode: string;
  skuCode: string | null;
  itemName: string | null;
  sourceStatus: string | null;
  inventoryType: string | null;
  returnReason: string | null;
  putawayQcComment: string | null;
  returnRemarks: string | null;
  catalogImageUrl: string | null;
}

export interface ReturnEvent {
  id: string;
  type: EventType;
  actor: string;
  payload: Record<string, unknown> | null;
  occurredAt: string;
}

export interface ReturnDetail extends ReturnSummary {
  account: string;
  facilityCode: string;
  shipmentCode: string | null;
  reversePickupCode: string | null;
  rtoCourier: string | null;
  rtoTrackingNumber: string | null;
  putawayCode: string | null;
  firstSyncedAt: string;
  lastSyncedAt: string;
  items: ReturnItem[];
  events: ReturnEvent[];
  /** How it arrived at our dock, for CX: condition tag, photo and the signed handover sheet. */
  dockArrival: DockArrival | null;
}

export interface DockArrival {
  batchId: string | null;
  courier: string | null;
  vehicleNo: string | null;
  scannedBy: string;
  scannedAt: string;
  condition: ParcelCondition | null;
  conditionNote: string | null;
  conditionPhotoUrl: string | null;
  signedSheetUrl: string | null;
}

export interface ReturnsListResponse {
  data: ReturnSummary[];
  total: number;
}

export interface StageCount {
  stage: Stage;
  count: number;
  overSla: number;
}

export interface PipelineResponse {
  stages: StageCount[];
  byType: Record<ReturnType, number>;
  total: number;
}

export interface SyncRun {
  id: string;
  /** Null for a scan lookup that found nothing in any account. */
  account: string | null;
  kind: SyncKind;
  status: SyncStatus;
  startedAt: string;
  finishedAt: string | null;
  windowFrom: string | null;
  windowTo: string | null;
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  error: string | null;
}

export interface SyncAccount {
  key: string;
  tenant: string;
  facility: string;
}

export interface SyncCursor {
  account: string;
  type: ReturnType;
  lastUpdatedTo: string;
}

export interface SyncStatusResponse {
  mode: UniwareMode;
  accounts: SyncAccount[];
  /** Accounts in .env with a value missing, by the names of the missing variables. */
  incompleteAccounts: { key: string; missing: string[] }[];
  running: boolean;
  intervalMinutes: number;
  lastSuccessAt: string | null;
  nextRunAt: string | null;
  cursors: SyncCursor[];
  runs: SyncRun[];
}

export interface LookupResponse {
  found: boolean;
  source: 'local' | 'uniware' | null;
  data: ReturnDetail | null;
}

/** A count split by return type, plus the total. */
export type TypeCounts = Record<ReturnType, number> & { total: number };

export interface AgeBucket {
  label: string;
  count: number;
}

export interface CourierPending {
  courier: string;
  count: number;
  oldestHours: number;
}

/** The day so far, and everything still waiting on Uniware. */
export interface OverviewResponse {
  /** Which clock the ages and TAT below are measured on. */
  clock: ClockMode;
  /** Start of today, local time. */
  day: string;
  expected: TypeCounts;
  receivedToday: TypeCounts;
  processedToday: TypeCounts;
  /** Of those, never scanned or listed at our dock: no arrival record, so no turnaround. */
  processedTodayWithoutDock: number;
  /** In Uniware (acknowledged / returned), putaway not closed yet. */
  manifested: TypeCounts;
  /** Putaway closed today: stock back in inventory. */
  closedToday: TypeCounts;
  /** Of those, never scanned or listed at our dock. */
  closedTodayWithoutDock: number;
  pending: TypeCounts;
  /** Pending returns that arrived before today. */
  carriedOver: number;
  pendingAges: AgeBucket[];
  pendingByCourier: CourierPending[];
  exceptionsOpen: number;
  /** Received-to-processed time for returns processed today. */
  tatTodayMedianHours: number | null;
  dispatch: DispatchSummary;
  /** Receiving batches still waiting for their signed sheet. */
  batches: { open: number; unsignedOverdue: number; receiveOverdue: number; dispatchOverdue: number };
}

/**
 * One inward day: the parcels that reached our dock that day, followed
 * through. Processed and pending are of those parcels, as of now.
 */
export interface TatDay {
  /** Local date, YYYY-MM-DD: the inward (dock arrival) date. */
  day: string;
  received: TypeCounts;
  processed: TypeCounts;
  pending: TypeCounts;
  /** Processed in Uniware but putaway not closed yet. */
  putawayPending: number;
  /** Dock-to-Uniware time of the ones processed so far. */
  medianHours: number | null;
  p90Hours: number | null;
  /** All three gaps: inward -> processed -> putaway closed. */
  legs: Record<TimeLeg, LegStats>;
}

/** Hours on the report's clock: median (half were faster) and slowest 1 in 10. */
export interface LegStats {
  medianHours: number | null;
  p90Hours: number | null;
  /** How many returns this is measured over. */
  count: number;
}

export interface TatCourier {
  courier: string;
  /** Inward in the period. */
  received: number;
  processed: number;
  pending: number;
  putawayPending: number;
  legs: Record<TimeLeg, LegStats>;
  medianHours: number | null;
  p90Hours: number | null;
}

/** Turnaround from arriving at the warehouse to processed in Uniware. */
export interface TatReportResponse {
  clock: ClockMode;
  days: TatDay[];
  byCourier: TatCourier[];
  /**
   * Processed in the period with no dock record (never scanned or listed at
   * our dock): no inward date, so not in these numbers.
   */
  processedWithoutDock: number;
}

export interface SettingsResponse {
  workSchedule: WorkSchedule;
}

export interface ApiError {
  error: string;
}

/** A brand whose returns we handle: one Uniware account. */
export interface Client {
  key: string;
  name: string;
}

export interface ClientsResponse {
  clients: Client[];
}

/** Filters shared by the board and reports. Dates are local days (YYYY-MM-DD), both ends included. */
export interface ScopeFilters {
  client?: string;
  /** Any code someone might have: AWB, return/shipment code, order, reverse pickup, SKU or item name. */
  q?: string;
  from?: string;
  to?: string;
}

/** A change of status on a given day, as counted in the movements report. */
export const MovementKind = {
  /** Created in Uniware: a new expected return. */
  CREATED: 'created',
  /** Arrived at our dock (desk scan or receiving sheet). */
  ARRIVED: 'arrived',
  /** Processed in Uniware. */
  PROCESSED: 'processed',
  /** Cancelled in Uniware. */
  CANCELLED: 'cancelled',
} as const;

export type MovementKind = (typeof MovementKind)[keyof typeof MovementKind];

export const MOVEMENT_KINDS: MovementKind[] = [MovementKind.CREATED, MovementKind.ARRIVED, MovementKind.PROCESSED, MovementKind.CANCELLED];

export const MOVEMENT_LABEL: Record<MovementKind, string> = {
  [MovementKind.CREATED]: 'New in Uniware',
  [MovementKind.ARRIVED]: 'Arrived at dock',
  [MovementKind.PROCESSED]: 'Processed',
  [MovementKind.CANCELLED]: 'Cancelled',
};

export interface MovementDay {
  /** Local day, YYYY-MM-DD. */
  day: string;
  counts: Record<MovementKind, number>;
  /** Processed that day with no dock record: their turnaround can't be measured. */
  processedWithoutArrival: number;
  /** At the dock, not yet processed in Uniware, when the day ended. */
  pendingAtClose: number;
}

export interface MovementsResponse {
  days: MovementDay[];
}

/** One day at dispatch. */
export interface DispatchDay {
  /** Local date, YYYY-MM-DD. */
  day: string;
  /** Courier pickups (dispatch handovers) started. */
  pickups: number;
  /** Parcels that passed the check and went with the courier. */
  handedOver: number;
  /** Orders found cancelled after manifest. */
  cancellationsCaught: number;
  /** Of those, pulled out before the courier took them: RTOs avoided. */
  pulled: number;
  /** Handed over anyway: they'll come back as RTOs. */
  missed: number;
}

export interface DispatchReportResponse {
  days: DispatchDay[];
}
