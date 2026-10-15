// All reads and writes of returns, items and events.

import { randomUUID } from 'node:crypto';

import {
  Actor,
  EventType,
  type PipelineResponse,
  type ReturnDetail,
  type ReturnEvent,
  type ReturnItem,
  ReturnSort,
  type ReturnSummary,
  type MovementKind,
  type ScopeFilters,
  type DockArrival,
  type ParcelCondition,
  type Client,
  ReturnType,
  ALL_STAGES,
  ClockMode,
  ReceivedSource,
  isLate,
  STAGE_SLA_HOURS,
  Stage,
  laterStage,
} from '@hexabuild/shared';

import { type UniwareAccount, config } from '../config.ts';
import { db, transaction } from '../db/index.ts';
import { MOVEMENT_DATE_SQL, MOVEMENT_WHERE_SQL } from '../lib/movements.ts';
import { scopeSql } from '../lib/scope.ts';
import { uploadUrl } from '../lib/uploads.ts';
import { HOUR_MS, nowIso } from '../lib/time.ts';
import type { ItemRecord, ReturnRecord } from '../uniware/mapper.ts';

const SOURCE_UNIWARE = 'UNIWARE';

export const UpsertOutcome = {
  CREATED: 'created',
  UPDATED: 'updated',
  UNCHANGED: 'unchanged',
} as const;

export type UpsertOutcome = (typeof UpsertOutcome)[keyof typeof UpsertOutcome];

type Row = Record<string, unknown>;

const str = (value: unknown) => (value === null || value === undefined ? null : String(value));

/** When a return reached the warehouse: our dock scan, else the courier's delivery date. */
/** Arrival at our dock: from a desk scan or the receiving sheet. Never Uniware's dates. */
export const RECEIVED_AT_SQL = 'r.dock_received_at';

export const SUMMARY_COLUMNS = `
  r.id, r.type, r.source_code, r.source_status, r.stage, r.stage_changed_at, r.sale_order_code,
  r.courier, COALESCE(r.rto_tracking_number, r.tracking_number) AS tracking_number, r.rto_reason,
  r.source_created_at, r.delivered_at, r.dock_received_at, r.dock_received_by, r.dock_received_source,
  r.inventory_received_at, r.completed_at, r.processed_at,
  (SELECT COUNT(*) FROM return_items i WHERE i.return_id = r.id) AS item_count,
  (SELECT i.item_name FROM return_items i WHERE i.return_id = r.id ORDER BY i.sale_order_item_code LIMIT 1) AS first_item_name,
  (SELECT i.return_reason FROM return_items i WHERE i.return_id = r.id ORDER BY i.sale_order_item_code LIMIT 1) AS first_reason
`;

function receivedSource(row: Row): ReceivedSource | null {
  if (!row.dock_received_at) {
    return null;
  }

  return row.dock_received_source === ReceivedSource.SHEET ? ReceivedSource.SHEET : ReceivedSource.DOCK;
}

export function toSummary(row: Row): ReturnSummary {
  return {
    id: String(row.id),
    type: row.type as ReturnType,
    sourceCode: String(row.source_code),
    sourceStatus: str(row.source_status),
    stage: row.stage as Stage,
    stageChangedAt: String(row.stage_changed_at),
    saleOrderCode: str(row.sale_order_code),
    courier: str(row.courier),
    trackingNumber: str(row.tracking_number),
    rtoReason: str(row.rto_reason),
    itemCount: Number(row.item_count),
    firstItemName: str(row.first_item_name),
    firstReason: str(row.first_reason),
    sourceCreatedAt: str(row.source_created_at),
    deliveredAt: str(row.delivered_at),
    dockReceivedAt: str(row.dock_received_at),
    dockReceivedBy: str(row.dock_received_by),
    receivedAt: str(row.dock_received_at),
    receivedSource: receivedSource(row),
    processedAt: str(row.processed_at),
    inventoryReceivedAt: str(row.inventory_received_at),
    completedAt: str(row.completed_at),
  };
}

function toItem(row: Row): ReturnItem {
  return {
    id: String(row.id),
    saleOrderItemCode: String(row.sale_order_item_code),
    skuCode: str(row.sku_code),
    itemName: str(row.item_name),
    sourceStatus: str(row.source_status),
    inventoryType: str(row.inventory_type),
    returnReason: str(row.return_reason),
    putawayQcComment: str(row.putaway_qc_comment),
    returnRemarks: str(row.return_remarks),
    catalogImageUrl: str(row.catalog_image_url),
  };
}

function toEvent(row: Row): ReturnEvent {
  return {
    id: String(row.id),
    type: row.type as ReturnEvent['type'],
    actor: String(row.actor),
    payload: row.payload ? JSON.parse(String(row.payload)) : null,
    occurredAt: String(row.occurred_at),
  };
}

export function insertEvent(event: {
  returnId: string;
  itemId?: string | null;
  type: EventType;
  actor: string;
  payload?: Record<string, unknown>;
  occurredAt?: string | null;
  clientActionId?: string | null;
}) {
  const recordedAt = nowIso();

  db.prepare(
    `INSERT INTO events (id, return_id, item_id, type, actor, payload, client_action_id, occurred_at, recorded_at)
     VALUES (:id, :returnId, :itemId, :type, :actor, :payload, :clientActionId, :occurredAt, :recordedAt)`
  ).run({
    id: randomUUID(),
    returnId: event.returnId,
    itemId: event.itemId ?? null,
    type: event.type,
    actor: event.actor,
    payload: event.payload ? JSON.stringify(event.payload) : null,
    clientActionId: event.clientActionId ?? null,
    occurredAt: event.occurredAt ?? recordedAt,
    recordedAt,
  });
}

const SOURCE_FIELDS = {
  source_status: 'sourceStatus',
  sale_order_code: 'saleOrderCode',
  shipment_code: 'shipmentCode',
  reverse_pickup_code: 'reversePickupCode',
  courier: 'courier',
  tracking_number: 'trackingNumber',
  rto_courier: 'rtoCourier',
  rto_tracking_number: 'rtoTrackingNumber',
  rto_reason: 'rtoReason',
  putaway_code: 'putawayCode',
  source_created_at: 'sourceCreatedAt',
  delivered_at: 'deliveredAt',
  inventory_received_at: 'inventoryReceivedAt',
  completed_at: 'completedAt',
  processed_at: 'processedAt',
} as const satisfies Record<string, keyof ReturnRecord>;

const ITEM_SOURCE_FIELDS = {
  sku_code: 'skuCode',
  item_name: 'itemName',
  source_status: 'sourceStatus',
  inventory_type: 'inventoryType',
  return_reason: 'returnReason',
  putaway_qc_comment: 'putawayQcComment',
  return_remarks: 'returnRemarks',
  catalog_image_url: 'catalogImageUrl',
  courier_status: 'courierStatus',
  tracking_status: 'trackingStatus',
} as const satisfies Record<string, keyof ItemRecord>;

function sourceParams<T, K extends keyof T>(record: T, fields: Record<string, K>) {
  return Object.fromEntries(Object.entries(fields).map(([column, key]) => [column, record[key] ?? null]));
}

function upsertItems(returnId: string, items: ItemRecord[]) {
  const findItem = db.prepare('SELECT id FROM return_items WHERE return_id = ? AND sale_order_item_code = ?');

  const columns = Object.keys(ITEM_SOURCE_FIELDS);

  for (const item of items) {
    const existing = findItem.get(returnId, item.saleOrderItemCode);

    const params = sourceParams(item, ITEM_SOURCE_FIELDS);

    if (!existing) {
      db.prepare(
        `INSERT INTO return_items (id, return_id, sale_order_item_code, ${columns.join(', ')})
         VALUES (:id, :returnId, :code, ${columns.map(c => `:${c}`).join(', ')})`
      ).run({
        ...params,
        id: randomUUID(),
        returnId,
        code: item.saleOrderItemCode,
      });

      continue;
    }

    db.prepare(`UPDATE return_items SET ${columns.map(c => `${c} = :${c}`).join(', ')} WHERE id = :id`).run({
      ...params,
      id: String(existing.id),
    });
  }
}

/**
 * Inserts or updates one return from Uniware. Uniware's fields are
 * overwritten; our stage only ever moves forward.
 */
export function upsertReturn(account: UniwareAccount, record: ReturnRecord): UpsertOutcome {
  return transaction(() => {
    const now = nowIso();

    const reachedAt = record.stageReachedAt ?? record.sourceCreatedAt ?? now;

    const existing = db
      .prepare(
        `SELECT id, stage, source_hash FROM returns
         WHERE account = ? AND type = ? AND source_code = ?`
      )
      .get(account.key, record.type, record.sourceCode);

    const params = sourceParams(record, SOURCE_FIELDS);

    const columns = Object.keys(SOURCE_FIELDS);

    if (!existing) {
      const id = randomUUID();

      db.prepare(
        `INSERT INTO returns (id, account, facility_code, source, source_code, type, ${columns.join(', ')},
           source_hash, stage, stage_changed_at, first_synced_at, last_synced_at)
         VALUES (:id, :account, :facilityCode, :source, :sourceCode, :type, ${columns.map(c => `:${c}`).join(', ')},
           :sourceHash, :stage, :stageChangedAt, :now, :now)`
      ).run({
        ...params,
        id,
        account: account.key,
        facilityCode: account.facility,
        source: SOURCE_UNIWARE,
        sourceCode: record.sourceCode,
        type: record.type,
        sourceHash: record.sourceHash,
        stage: record.stage,
        stageChangedAt: reachedAt,
        now,
      });

      upsertItems(id, record.items);

      insertEvent({
        returnId: id,
        type: EventType.IMPORTED,
        actor: Actor.SYNC,
        payload: { stage: record.stage, sourceStatus: record.sourceStatus },
        occurredAt: record.sourceCreatedAt,
      });

      return UpsertOutcome.CREATED;
    }

    const id = String(existing.id);

    if (existing.source_hash === record.sourceHash) {
      db.prepare('UPDATE returns SET last_synced_at = ? WHERE id = ?').run(now, id);
      return UpsertOutcome.UNCHANGED;
    }

    const previousStage = existing.stage as Stage;

    const stage = laterStage(previousStage, record.stage);

    const stageChanged = stage !== previousStage;

    db.prepare(
      `UPDATE returns SET ${columns.map(c => `${c} = :${c}`).join(', ')},
         source_hash = :sourceHash,
         stage = :stage,
         stage_changed_at = CASE WHEN :stageChanged THEN :stageChangedAt ELSE stage_changed_at END,
         last_synced_at = :now
       WHERE id = :id`
    ).run({
      ...params,
      id,
      sourceHash: record.sourceHash,
      stage,
      stageChanged: stageChanged ? 1 : 0,
      stageChangedAt: reachedAt,
      now,
    });

    upsertItems(id, record.items);

    insertEvent({
      returnId: id,
      type: EventType.SOURCE_UPDATED,
      actor: Actor.SYNC,
      payload: { sourceStatus: record.sourceStatus },
    });

    if (stageChanged) {
      insertEvent({
        returnId: id,
        type: EventType.STAGE_CHANGED,
        actor: Actor.SYNC,
        payload: { from: previousStage, to: stage },
        occurredAt: reachedAt,
      });
    }

    return UpsertOutcome.UPDATED;
  });
}

export interface ListFilters extends ScopeFilters {
  /** Count the date range on this movement's date instead of the current stage's. */
  movement?: MovementKind;
  /** Only returns processed in Uniware whose putaway isn't closed yet. */
  putawayPending?: boolean;
  stage?: Stage;
  type?: ReturnType;
  q?: string;
  sort: ReturnSort;
  limit: number;
  offset: number;
}

const ORDER_BY: Record<ReturnSort, string> = {
  [ReturnSort.STAGE_AGE]: 'r.stage_changed_at ASC',
  [ReturnSort.RECENT]: 'r.source_created_at DESC',
};

export function listReturns(filters: ListFilters): {
  data: ReturnSummary[];
  total: number;
} {
  const where: string[] = [];

  const params: Record<string, string | number> = {};

  if (filters.stage) {
    where.push('r.stage = :stage');
    params.stage = filters.stage;
  }

  if (filters.type) {
    where.push('r.type = :type');
    params.type = filters.type;
  }

  if (filters.putawayPending) {
    where.push('r.processed_at IS NOT NULL AND r.inventory_received_at IS NULL');
  }

  // Search (q) is part of the scope below, shared with the board's counts.

  // A return is in the date range if it reached its current stage then,
  // or, for a movement, if that movement happened then.
  const dateColumn = filters.movement ? MOVEMENT_DATE_SQL[filters.movement] : 'r.stage_changed_at';

  const movementWhere = filters.movement ? MOVEMENT_WHERE_SQL[filters.movement] : '';

  const scope = scopeSql(filters, dateColumn);

  Object.assign(params, scope.params);

  const whereSql = `WHERE 1 = 1 ${where.map(part => `AND ${part}`).join(' ')} ${movementWhere} ${scope.sql}`;

  const orderBy = filters.movement ? `${dateColumn} DESC` : ORDER_BY[filters.sort];

  const total = Number(db.prepare(`SELECT COUNT(*) AS n FROM returns r ${whereSql}`).get(params)?.n ?? 0);

  const rows = db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS} FROM returns r ${whereSql}
       ORDER BY ${orderBy}
       LIMIT :limit OFFSET :offset`
    )
    .all({ ...params, limit: filters.limit, offset: filters.offset });

  return { data: rows.map(toSummary), total };
}

export function getReturnDetail(id: string): ReturnDetail | null {
  const row = db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS}, r.account, r.facility_code, r.shipment_code, r.reverse_pickup_code, r.rto_courier,
         r.rto_tracking_number, r.putaway_code, r.first_synced_at, r.last_synced_at
       FROM returns r WHERE r.id = ?`
    )
    .get(id);

  if (!row) {
    return null;
  }

  const items = db.prepare('SELECT * FROM return_items WHERE return_id = ? ORDER BY sale_order_item_code').all(id);

  const events = db.prepare('SELECT * FROM events WHERE return_id = ? ORDER BY occurred_at DESC').all(id);

  return {
    ...toSummary(row),
    account: String(row.account),
    facilityCode: String(row.facility_code),
    shipmentCode: str(row.shipment_code),
    reversePickupCode: str(row.reverse_pickup_code),
    rtoCourier: str(row.rto_courier),
    rtoTrackingNumber: str(row.rto_tracking_number),
    putawayCode: str(row.putaway_code),
    firstSyncedAt: String(row.first_synced_at),
    lastSyncedAt: String(row.last_synced_at),
    items: items.map(toItem),
    events: events.map(toEvent),
    dockArrival: dockArrival(id),
  };
}

/** How it arrived at our dock: a tagged scan if there is one, else the first scan. */
function dockArrival(returnId: string): DockArrival | null {
  const row = db
    .prepare(
      `SELECT rc.batch_id, rc.scanned_by, rc.scanned_at, rc.condition, rc.condition_note, rc.condition_photo,
         b.courier, b.vehicle_no, b.signed_sheet
       FROM receipts rc LEFT JOIN receiving_batches b ON b.id = rc.batch_id
       WHERE rc.return_id = ? ORDER BY rc.condition IS NULL, rc.scanned_at LIMIT 1`
    )
    .get(returnId);

  if (!row) {
    return null;
  }

  return {
    batchId: str(row.batch_id),
    courier: str(row.courier),
    vehicleNo: str(row.vehicle_no),
    scannedBy: String(row.scanned_by),
    scannedAt: String(row.scanned_at),
    condition: str(row.condition) as ParcelCondition | null,
    conditionNote: str(row.condition_note),
    conditionPhotoUrl: uploadUrl(str(row.condition_photo)),
    signedSheetUrl: uploadUrl(str(row.signed_sheet)),
  };
}

/**
 * Finds a return by any code a worker might scan: tracking, shipment, pickup
 * or order. Case and spaces don't matter, the way scanners and typists differ.
 */
export function findReturnIdByCode(code: string): string | null {
  const normalized = code.replace(/\s+/g, '');

  const row = db
    .prepare(
      `SELECT id FROM returns
       WHERE tracking_number = :code COLLATE NOCASE OR rto_tracking_number = :code COLLATE NOCASE
         OR shipment_code = :code COLLATE NOCASE OR reverse_pickup_code = :code COLLATE NOCASE
         OR source_code = :code COLLATE NOCASE OR sale_order_code = :code COLLATE NOCASE
       ORDER BY stage_changed_at DESC LIMIT 1`
    )
    .get({ code: normalized });

  return row ? String(row.id) : null;
}

/** Pending returns past their limit, on the given clock (counted in code: working hours aren't SQL). */
function countLatePending(clock: ClockMode, type: ReturnType | undefined, now: number, scope: ScopeFilters): number {
  const typeFilter = type ? 'AND r.type = :type' : '';

  const scoped = scopeSql(scope, 'r.stage_changed_at');

  return db
    .prepare(`SELECT ${RECEIVED_AT_SQL} AS received_at FROM returns r WHERE r.stage = :stage ${typeFilter} ${scoped.sql}`)
    .all({ stage: Stage.RECEIVED, ...(type ? { type } : {}), ...scoped.params })
    .filter(row => row.received_at && isLate(Stage.RECEIVED, String(row.received_at), now, clock, config.workSchedule)).length;
}

/** Stage counts, optionally for one return type. byType always covers everything. */
export function getPipeline(type?: ReturnType, clock: ClockMode = ClockMode.WORKING, scope: ScopeFilters = {}): PipelineResponse {
  const now = Date.now();

  const typeFilter = type ? 'AND r.type = :type' : '';

  const scoped = scopeSql(scope, 'r.stage_changed_at');

  const countStage = db.prepare(`SELECT COUNT(*) AS n FROM returns r WHERE r.stage = :stage ${typeFilter} ${scoped.sql}`);

  const countLate = db.prepare(
    `SELECT COUNT(*) AS n FROM returns r WHERE r.stage = :stage AND r.stage_changed_at < :before ${typeFilter} ${scoped.sql}`
  );

  const stages = ALL_STAGES.map(stage => {
    const slaHours = STAGE_SLA_HOURS[stage];

    const params: Record<string, string> = {
      stage,
      ...(type ? { type } : {}),
      ...scoped.params,
    };

    const count = Number(countStage.get(params)?.n ?? 0);

    if (slaHours === null) {
      return { stage, count, overSla: 0 };
    }

    if (stage === Stage.RECEIVED) {
      return {
        stage,
        count,
        overSla: countLatePending(clock, type, now, scope),
      };
    }

    const before = new Date(now - slaHours * HOUR_MS).toISOString();

    return {
      stage,
      count,
      overSla: Number(countLate.get({ ...params, before })?.n ?? 0),
    };
  });

  const typeRows = db.prepare(`SELECT r.type, COUNT(*) AS n FROM returns r WHERE 1 = 1 ${scoped.sql} GROUP BY r.type`).all(scoped.params);

  const byType = { [ReturnType.RTO]: 0, [ReturnType.CIR]: 0 };

  for (const row of typeRows) {
    byType[row.type as ReturnType] = Number(row.n);
  }

  return {
    stages,
    byType,
    total: byType[ReturnType.RTO] + byType[ReturnType.CIR],
  };
}

const MOCK_CLIENT_NAME = 'Mock data';

/** Every brand that has returns here, named after its Uniware tenant. */
export function listClients(): Client[] {
  const names = new Map<string, string>(config.uniware.accounts.map(account => [account.key, account.tenant]));

  names.set(config.uniware.importAccount.key, config.uniware.importAccount.tenant);

  return db
    .prepare('SELECT DISTINCT account FROM returns ORDER BY account')
    .all()
    .map(row => String(row.account))
    .map(key => ({
      key,
      name: names.get(key) ?? (key === 'MOCK' ? MOCK_CLIENT_NAME : key),
    }));
}
