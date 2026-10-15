// Stand-in for Uniware when no credentials are set. Generates a stable set of
// realistic returns and serves them through the same interface as the live
// client, so the rest of the app can't tell the difference.
//
// Each return has a timeline (created → delivered → received → completed).
// Steps later than "now" haven't happened yet, so returns move forward on
// their own as time passes and incremental sync picks the changes up.

import { ReturnType } from '@hexabuild/shared';

import { sleep } from '../lib/async.ts';
import { DAY_MS, HOUR_MS } from '../lib/time.ts';
import type {
  SearchWindow,
  UniwareClient,
  UniwareOrderHit,
  UniwareReturnDetail,
  UniwareReturnItem,
  UniwareSaleOrder,
  UniwareSearchHit,
} from './types.ts';
import { SaleOrderStatus, SearchDateField, UniwareError } from './types.ts';

const RETURN_COUNT = 180;

const HISTORY_DAYS = 32;

const ItemStatus = {
  RECEIVED: 'RECEIVED',
  NOT_RECEIVED: 'NOT_RECEIVED',
} as const;

const InventoryType = {
  GOOD: 'GOOD_INVENTORY',
  BAD: 'BAD_INVENTORY',
} as const;

const CirStatus = {
  CREATED: 'CREATED',
  COMPLETE: 'COMPLETE',
  CANCELLED: 'CANCELLED',
} as const;

// Customer returns Uniware cancels because the pickup never happened in time.
const CIR_CANCEL_SHARE = 0.08;

const CIR_CANCEL_AFTER_DAYS = 12;

// "Never happens": later than any real now.
const NEVER = Number.MAX_SAFE_INTEGER;

const PRODUCTS = [
  { sku: 'KRT-BLU-M', name: 'Cotton Straight Kurta, Indigo, M' },
  { sku: 'KRT-MRN-L', name: 'Printed A-Line Kurta, Maroon, L' },
  { sku: 'KRT-WHT-S', name: 'Chikankari Kurta, White, S' },
  { sku: 'JNS-SLM-32', name: 'Slim Fit Jeans, Dark Wash, 32' },
  { sku: 'JNS-RLX-34', name: 'Relaxed Fit Jeans, Light Wash, 34' },
  { sku: 'TSH-BLK-L', name: 'Crew Neck T-Shirt, Black, L' },
  { sku: 'TSH-OLV-M', name: 'Crew Neck T-Shirt, Olive, M' },
  { sku: 'SHR-LIN-40', name: 'Linen Shirt, Sky Blue, 40' },
  { sku: 'DRS-FLR-M', name: 'Floral Midi Dress, M' },
  { sku: 'SNK-WHT-9', name: 'Leather Sneakers, White, UK 9' },
  { sku: 'SNK-GRY-8', name: 'Running Shoes, Grey, UK 8' },
  { sku: 'SAR-SLK-FS', name: 'Banarasi Silk Saree, Teal' },
  { sku: 'DUP-CHF-FS', name: 'Chiffon Dupatta, Peach' },
  { sku: 'BAG-TOT-BR', name: 'Canvas Tote Bag, Brown' },
  { sku: 'JKT-DNM-M', name: 'Denim Jacket, Mid Blue, M' },
  { sku: 'PLZ-BLK-L', name: 'Palazzo Pants, Black, L' },
];

const COURIERS = [
  { code: 'DELHIVERY', name: 'Delhivery', prefix: '1490' },
  { code: 'BLUEDART', name: 'Blue Dart', prefix: '7731' },
  { code: 'EKART', name: 'Ekart', prefix: 'FMPP' },
  { code: 'XPRESSBEES', name: 'Xpressbees', prefix: '1412' },
  { code: 'SHADOWFAX', name: 'Shadowfax', prefix: 'SF' },
];

const RTO_REASONS = [
  'Customer refused delivery',
  'Customer not available',
  'Incomplete address',
  'COD amount not ready',
  'Phone not reachable',
];

const CIR_REASONS = [
  'Size too small',
  'Size too large',
  'Damaged product',
  'Wrong item received',
  'Quality not as expected',
  'Colour different from image',
  'Changed my mind',
];

// mulberry32: small seeded random generator, so the data is the same on every run.
function seededRandom(seed: number) {
  let state = seed;

  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface MockReturn {
  code: string;
  type: ReturnType;
  saleOrderCode: string;
  shipmentCode: string;
  reversePickupCode: string | null;
  courier: (typeof COURIERS)[number];
  trackingNumber: string;
  rtoTrackingNumber: string | null;
  rtoReason: string | null;
  items: { sku: string; name: string; reason: string; good: boolean; code: string }[];
  createdAt: number;
  deliveredAt: number;
  receivedAt: number;
  putawayAt: number;
  completedAt: number;
  cancelledAt: number;
}

function generate(): MockReturn[] {
  const random = seededRandom(20261016);

  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];

  const between = (min: number, max: number) => min + random() * (max - min);

  const digits = (n: number) => Array.from({ length: n }, () => Math.floor(random() * 10)).join('');

  // Anchored to the start of today so restarts during the day give the same data.
  const anchor = new Date().setHours(0, 0, 0, 0);

  return Array.from({ length: RETURN_COUNT }, (_, index) => {
    const type = random() < 0.55 ? ReturnType.RTO : ReturnType.CIR;

    const courier = pick(COURIERS);

    const createdAt = anchor - between(-1, HISTORY_DAYS) * DAY_MS;

    const cancelled = type === ReturnType.CIR && random() < CIR_CANCEL_SHARE;

    const deliveredAt = cancelled ? NEVER : createdAt + between(3, type === ReturnType.RTO ? 10 : 14) * DAY_MS;

    // Most are processed within a day of arriving; about 1 in 8 waits days.
    const receivedAt = cancelled ? NEVER : deliveredAt + (random() < 0.12 ? between(3, 6) * DAY_MS : between(2, 30) * HOUR_MS);

    const putawayAt = cancelled ? NEVER : receivedAt + between(1, 20) * HOUR_MS;

    const completedAt = cancelled ? NEVER : putawayAt + between(2, 36) * HOUR_MS;

    const cancelledAt = cancelled ? createdAt + CIR_CANCEL_AFTER_DAYS * DAY_MS : NEVER;

    const itemCount = random() < 0.7 ? 1 : random() < 0.8 ? 2 : 3;

    const serial = String(index + 1).padStart(5, '0');

    const reason = type === ReturnType.RTO ? pick(RTO_REASONS) : pick(CIR_REASONS);

    return {
      code: type === ReturnType.RTO ? `SHP${serial}` : `RP${serial}`,
      type,
      saleOrderCode: `SO-${digits(7)}`,
      shipmentCode: `SHP${serial}`,
      reversePickupCode: type === ReturnType.CIR ? `RP${serial}` : null,
      courier,
      trackingNumber: `${courier.prefix}${digits(10)}`,
      rtoTrackingNumber: type === ReturnType.RTO ? `${courier.prefix}${digits(10)}` : null,
      rtoReason: type === ReturnType.RTO ? reason : null,
      items: Array.from({ length: itemCount }, (_, itemIndex) => {
        const product = pick(PRODUCTS);

        return {
          sku: product.sku,
          name: product.name,
          reason: type === ReturnType.RTO ? reason : itemIndex === 0 ? reason : pick(CIR_REASONS),
          good: random() < 0.82,
          code: `SOI-${serial}-${itemIndex + 1}`,
        };
      }),
      createdAt,
      deliveredAt,
      receivedAt,
      putawayAt,
      completedAt,
      cancelledAt,
    };
  });
}

const happened = (at: number, now: number) => (at <= now ? at : null);

function lastUpdate(r: MockReturn, now: number): number {
  return Math.max(
    ...[r.createdAt, r.deliveredAt, r.receivedAt, r.putawayAt, r.completedAt, r.cancelledAt].filter(at => at <= now)
  );
}

function cirStatusAt(r: MockReturn, completed: number | null, now: number): string {
  if (completed) {
    return CirStatus.COMPLETE;
  }

  return r.cancelledAt <= now ? CirStatus.CANCELLED : CirStatus.CREATED;
}

function toDetail(r: MockReturn, now: number): UniwareReturnDetail {
  const received = happened(r.receivedAt, now);

  const completed = happened(r.completedAt, now);

  const items: UniwareReturnItem[] = r.items.map(item => ({
    skuCode: item.sku,
    saleOrderItemCode: item.code,
    saleOrderItemStatus: received ? ItemStatus.RECEIVED : ItemStatus.NOT_RECEIVED,
    saleOrderCode: r.saleOrderCode,
    shipmentCode: r.shipmentCode,
    reversePickupCode: r.reversePickupCode ?? undefined,
    inventoryType: received ? (item.good ? InventoryType.GOOD : InventoryType.BAD) : undefined,
    marketplaceReturnReason: item.reason,
    putawayQcComment: received && !item.good ? 'Damaged on inspection' : undefined,
    itemName: item.name,
  }));

  const cirStatus = cirStatusAt(r, completed, now);

  const rtoStatus = received ? ItemStatus.RECEIVED : ItemStatus.NOT_RECEIVED;

  return {
    successful: true,
    returnSaleOrderItems: items,
    returnSaleOrderValue: {
      returnStatus: r.type === ReturnType.CIR ? cirStatus : rtoStatus,
      saleOrderCode: r.saleOrderCode,
      shipmentCode: r.shipmentCode,
      reversePickupCode: r.reversePickupCode ?? undefined,
      trackingNumber: r.trackingNumber,
      shippingProviderCode: r.courier.code,
      courierName: r.courier.name,
      rtoTrackingNumber: r.rtoTrackingNumber ?? undefined,
      rtoShippingProviderCode: r.rtoTrackingNumber ? r.courier.code : undefined,
      rtoCourierName: r.rtoTrackingNumber ? r.courier.name : undefined,
      rtoReason: r.rtoReason ?? undefined,
      returnCreatedDate: r.createdAt,
      returnDeliveryDate: happened(r.deliveredAt, now),
      inventoryReceivedDate: received,
      returnCompletedDate: completed,
      putawayCode: happened(r.putawayAt, now) ? `PA-${r.shipmentCode}` : undefined,
    },
  };
}

const formatHitDate = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

// --- Forward orders, for the cancellation guard ---------------------------
// Orders manifested over a window around server start. A few are cancelled
// after being manifested; some of those get dispatched anyway (missed), and
// some are cancelled later, so holds keep appearing while the demo runs.

const ORDER_COUNT = 220;

const ORDER_CANCEL_SHARE = 0.08;

const OrderItemStatus = {
  PACKED: 'PACKED',
  DISPATCHED: 'DISPATCHED',
  CANCELLED: 'CANCELLED',
} as const;

const CANCEL_REASONS = ['Customer cancelled', 'Ordered by mistake', 'Found a better price', 'Delivery too slow'];

interface MockOrder {
  code: string;
  packageCode: string;
  trackingNumber: string;
  courier: (typeof COURIERS)[number];
  items: { sku: string; name: string }[];
  manifestedAt: number;
  manifestCode: string;
  dispatchedAt: number;
  cancelledAt: number;
  cancelReason: string;
}

function generateOrders(anchor: number): MockOrder[] {
  const random = seededRandom(anchor % 2147483647);

  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];

  const between = (min: number, max: number) => min + random() * (max - min);

  const digits = (n: number) => Array.from({ length: n }, () => Math.floor(random() * 10)).join('');

  return Array.from({ length: ORDER_COUNT }, (_, index) => {
    const courier = pick(COURIERS);

    const manifestedAt = anchor + between(-6, 3) * HOUR_MS;

    const dispatchedAt = manifestedAt + between(1, 3) * HOUR_MS;

    const cancelled = random() < ORDER_CANCEL_SHARE;

    const manifestHour = new Date(manifestedAt).getHours();

    return {
      code: `SO-F${String(index + 1).padStart(5, '0')}`,
      packageCode: `PKG${digits(7)}`,
      trackingNumber: `${courier.prefix}${digits(10)}`,
      courier,
      items: Array.from({ length: random() < 0.8 ? 1 : 2 }, () => {
        const product = pick(PRODUCTS);
        return { sku: product.sku, name: product.name };
      }),
      manifestedAt,
      manifestCode: `MF-${courier.code.slice(0, 3)}-${String(manifestHour).padStart(2, '0')}00`,
      dispatchedAt,
      // Cancelled somewhere between manifest and a little after dispatch.
      cancelledAt: cancelled ? manifestedAt + between(0.1, 1.2) * (dispatchedAt - manifestedAt) : NEVER,
      cancelReason: pick(CANCEL_REASONS),
    };
  });
}

function orderItemStatus(cancelled: boolean, dispatched: boolean): string {
  if (cancelled) {
    return OrderItemStatus.CANCELLED;
  }

  return dispatched ? OrderItemStatus.DISPATCHED : OrderItemStatus.PACKED;
}

function toSaleOrder(order: MockOrder, now: number): UniwareSaleOrder {
  const cancelled = order.cancelledAt <= now;

  const dispatched = order.dispatchedAt <= now;

  const itemStatus = orderItemStatus(cancelled, dispatched);

  return {
    code: order.code,
    status: cancelled ? SaleOrderStatus.CANCELLED : 'PROCESSING',
    updated: Math.max(...[order.manifestedAt, order.dispatchedAt, order.cancelledAt].filter(at => at <= now)),
    saleOrderItems: order.items.map(item => ({
      statusCode: itemStatus,
      shippingPackageCode: order.packageCode,
      itemSku: item.sku,
      itemName: item.name,
      cancellationReason: cancelled ? order.cancelReason : undefined,
      updated: cancelled ? order.cancelledAt : order.manifestedAt,
    })),
    shippingPackages: [
      {
        code: order.packageCode,
        status: cancelled ? SaleOrderStatus.CANCELLED : 'PROCESSING',
        trackingNumber: order.trackingNumber,
        shippingManifestCode: order.manifestedAt <= now ? order.manifestCode : undefined,
        shippingProvider: order.courier.name,
        dispatched: dispatched ? order.dispatchedAt : undefined,
      },
    ],
  };
}

export class MockUniwareClient implements UniwareClient {
  private readonly returns = generate();

  private readonly orders = generateOrders(Date.now());

  async searchCancelledOrders(minutes: number): Promise<UniwareOrderHit[]> {
    await this.latency();

    const now = Date.now();

    const since = now - minutes * 60_000;

    return this.orders
      .filter(o => o.cancelledAt >= since && o.cancelledAt <= now)
      .map(o => ({ code: o.code, status: SaleOrderStatus.CANCELLED, updated: o.cancelledAt }));
  }

  async getSaleOrder(code: string): Promise<UniwareSaleOrder> {
    await this.latency();

    const order = this.orders.find(o => o.code === code);

    if (!order) {
      throw new UniwareError(`saleorder/get: no order ${code}`, 200);
    }

    return toSaleOrder(order, Date.now());
  }

  async searchReturns(type: ReturnType, window: SearchWindow): Promise<UniwareSearchHit[]> {
    await this.latency();

    const now = Date.now();

    const from = window.from.getTime();

    const to = window.to.getTime();

    return this.returns
      .filter(r => r.type === type && r.createdAt <= now)
      .filter(r => {
        const at = window.field === SearchDateField.CREATED ? r.createdAt : lastUpdate(r, now);
        return at >= from && at <= to;
      })
      .map(r => ({
        code: r.code,
        created: formatHitDate(r.createdAt),
        updated: formatHitDate(lastUpdate(r, now)),
      }));
  }

  async getReturn(code: string, type: ReturnType): Promise<UniwareReturnDetail> {
    await this.latency();

    const found = this.returns.find(r => r.code === code && r.type === type && r.createdAt <= Date.now());

    if (!found) {
      throw new UniwareError(`return/get: no return ${code}`, 200);
    }

    return toDetail(found, Date.now());
  }

  async findReturn(code: string): Promise<UniwareReturnDetail | null> {
    await this.latency();

    const now = Date.now();

    const found = this.returns.find(
      r =>
        r.createdAt <= now &&
        [r.shipmentCode, r.reversePickupCode, r.trackingNumber, r.rtoTrackingNumber].includes(code)
    );

    return found ? toDetail(found, now) : null;
  }

  private latency() {
    return sleep(30 + Math.random() * 90);
  }
}
