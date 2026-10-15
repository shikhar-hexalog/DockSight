// Turns a Uniware return/get response into our own record.
// Keeps only what the app needs: no names, phones, emails, addresses,
// customer photos or custom fields.

import { createHash } from 'node:crypto';

import { ReturnType, Stage } from '@hexabuild/shared';

import { toIso } from '../lib/time.ts';
import type { UniwareReturnDetail } from './types.ts';

// Uniware's status for a customer return that expired before it arrived.
const CANCELLED_STATUS = 'CANCELLED';

export interface ItemRecord {
  saleOrderItemCode: string;
  skuCode: string | null;
  itemName: string | null;
  sourceStatus: string | null;
  inventoryType: string | null;
  returnReason: string | null;
  putawayQcComment: string | null;
  returnRemarks: string | null;
  catalogImageUrl: string | null;
  courierStatus: string | null;
  trackingStatus: string | null;
}

export interface ReturnRecord {
  sourceCode: string;
  type: ReturnType;
  sourceStatus: string | null;
  saleOrderCode: string | null;
  shipmentCode: string | null;
  reversePickupCode: string | null;
  courier: string | null;
  trackingNumber: string | null;
  rtoCourier: string | null;
  rtoTrackingNumber: string | null;
  rtoReason: string | null;
  putawayCode: string | null;
  sourceCreatedAt: string | null;
  deliveredAt: string | null;
  inventoryReceivedAt: string | null;
  completedAt: string | null;
  processedAt: string | null;
  stage: Stage;
  /** When the record reached `stage`, per Uniware's own dates. */
  stageReachedAt: string | null;
  items: ItemRecord[];
  sourceHash: string;
}

const orNull = (value: string | undefined) => value?.trim() || null;

/**
 * When Uniware counts the return as processed: the first sign it's back in
 * inventory. ASSUMPTION, to confirm with the warehouse: for RTO that's the
 * inventory being received (manifest closed / putaway), for DTO the return
 * being completed. Whichever Uniware date comes first is used.
 */
function processedAt(dates: { inventoryReceivedAt: string | null; completedAt: string | null }): string | null {
  const known = [dates.inventoryReceivedAt, dates.completedAt].filter((d): d is string => d !== null);

  return known.length === 0 ? null : known.sort()[0];
}

// Uniware only ever says Expected, Processed or Cancelled. "Received at our
// dock" comes from our own records (desk scans, imported receiving sheets),
// never from Uniware: the courier's delivered date is kept for reference only.
function deriveStage(record: Pick<ReturnRecord, 'sourceStatus' | 'processedAt'>) {
  if (record.processedAt) {
    return { stage: Stage.PROCESSED, reachedAt: record.processedAt };
  }

  if (record.sourceStatus === CANCELLED_STATUS) {
    return { stage: Stage.CANCELLED, reachedAt: null };
  }

  return { stage: Stage.EXPECTED, reachedAt: null };
}

/** A return pulled up by a scanned code doesn't come with its type. */
export function inferType(detail: UniwareReturnDetail): { type: ReturnType; code: string } | null {
  const value = detail.returnSaleOrderValue ?? {};

  const firstItem = detail.returnSaleOrderItems?.[0] ?? {};

  const reversePickupCode = value.reversePickupCode ?? firstItem.reversePickupCode;

  if (reversePickupCode) {
    return { type: ReturnType.CIR, code: reversePickupCode };
  }

  const shipmentCode = value.shipmentCode ?? firstItem.shipmentCode;

  if (shipmentCode) {
    return { type: ReturnType.RTO, code: shipmentCode };
  }

  return null;
}

export function toReturnRecord(detail: UniwareReturnDetail, type: ReturnType, sourceCode: string): ReturnRecord {
  const value = detail.returnSaleOrderValue ?? {};

  const dates = {
    sourceCreatedAt: toIso(value.returnCreatedDate),
    deliveredAt: toIso(value.returnDeliveryDate),
    inventoryReceivedAt: toIso(value.inventoryReceivedDate),
    completedAt: toIso(value.returnCompletedDate),
  };

  const sourceStatus = orNull(value.returnStatus);

  const processed = processedAt(dates);

  const derived = deriveStage({ sourceStatus, processedAt: processed });

  const items: ItemRecord[] = (detail.returnSaleOrderItems ?? []).map((item, index) => ({
    saleOrderItemCode: orNull(item.saleOrderItemCode) ?? `${sourceCode}#${index + 1}`,
    skuCode: orNull(item.skuCode),
    itemName: orNull(item.itemName),
    sourceStatus: orNull(item.saleOrderItemStatus),
    inventoryType: orNull(item.inventoryType),
    returnReason: orNull(item.marketplaceReturnReason),
    putawayQcComment: orNull(item.putawayQcComment),
    returnRemarks: orNull(item.returnRemarks),
    catalogImageUrl: orNull(item.itemTypeImageUrl),
    courierStatus: orNull(item.courierStatus),
    trackingStatus: orNull(item.trackingStatus),
  }));

  const record: Omit<ReturnRecord, 'sourceHash'> = {
    sourceCode,
    type,
    sourceStatus,
    saleOrderCode: orNull(value.saleOrderCode),
    shipmentCode: orNull(value.shipmentCode),
    reversePickupCode: orNull(value.reversePickupCode),
    courier: orNull(value.courierName) ?? orNull(value.shippingProviderCode),
    trackingNumber: orNull(value.trackingNumber),
    rtoCourier: orNull(value.rtoCourierName) ?? orNull(value.rtoShippingProviderCode),
    rtoTrackingNumber: orNull(value.rtoTrackingNumber),
    rtoReason: orNull(value.rtoReason),
    putawayCode: orNull(value.putawayCode),
    ...dates,
    processedAt: processed,
    stage: derived.stage,
    stageReachedAt: derived.reachedAt,
    items,
  };

  return { ...record, sourceHash: hashRecord(record) };
}

export function hashRecord(value: unknown): string {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex');
}
