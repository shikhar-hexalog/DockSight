// The parts of Uniware's return APIs we use.
// Docs: https://documentation.unicommerce.com/docs/return-search.html
//       https://documentation.unicommerce.com/docs/return-get.html

import type { ReturnType } from '@hexabuild/shared';

/** Uniware dates arrive as epoch milliseconds or as date strings. */
export type UniwareDate = number | string | null;

export interface UniwareSearchHit {
  code: string;
  created: string;
  updated: string;
}

export interface UniwareReturnItem {
  skuCode?: string;
  saleOrderItemCode?: string;
  saleOrderItemStatus?: string;
  saleOrderCode?: string;
  reversePickupCode?: string;
  shipmentCode?: string;
  inventoryType?: string;
  marketplaceReturnReason?: string;
  putawayQcComment?: string;
  returnRemarks?: string;
  itemName?: string;
  itemTypeImageUrl?: string;
  courierStatus?: string;
  trackingStatus?: string;
}

export interface UniwareReturnValue {
  returnStatus?: string;
  saleOrderCode?: string;
  shipmentCode?: string;
  reversePickupCode?: string;
  trackingNumber?: string;
  shippingProviderCode?: string;
  courierName?: string;
  rtoTrackingNumber?: string;
  rtoShippingProviderCode?: string;
  rtoCourierName?: string;
  rtoReason?: string;
  returnCreatedDate?: UniwareDate;
  returnDeliveryDate?: UniwareDate;
  inventoryReceivedDate?: UniwareDate;
  returnCompletedDate?: UniwareDate;
  putawayCode?: string;
}

/** return/get response. Addresses and custom fields exist but are never read. */
export interface UniwareReturnDetail {
  successful: boolean;
  returnSaleOrderItems?: UniwareReturnItem[];
  returnSaleOrderValue?: UniwareReturnValue;
}

export const SearchDateField = {
  CREATED: 'created',
  UPDATED: 'updated',
} as const;

export type SearchDateField = (typeof SearchDateField)[keyof typeof SearchDateField];

export interface SearchWindow {
  field: SearchDateField;
  from: Date;
  to: Date;
}

// Sale orders, for the cancellation guard.
// Docs: https://documentation.unicommerce.com/docs/saleorder-search.html
//       https://documentation.unicommerce.com/docs/saleorder-get.html

export const SaleOrderStatus = {
  CANCELLED: 'CANCELLED',
} as const;

export interface UniwareOrderHit {
  code: string;
  status?: string;
  updated?: UniwareDate;
}

export interface UniwareSaleOrderItem {
  statusCode?: string;
  shippingPackageCode?: string;
  itemSku?: string;
  itemName?: string;
  cancellationReason?: string;
  updated?: UniwareDate;
}

export interface UniwareShippingPackage {
  code?: string;
  status?: string;
  trackingNumber?: string;
  shippingManifestCode?: string;
  shippingProvider?: string;
  dispatched?: UniwareDate;
}

export interface UniwareSaleOrder {
  code?: string;
  status?: string;
  updated?: UniwareDate;
  saleOrderItems?: UniwareSaleOrderItem[];
  shippingPackages?: UniwareShippingPackage[];
}

/** Everything the app needs from Uniware. Live and mock both implement it. */
export interface UniwareClient {
  searchReturns(type: ReturnType, window: SearchWindow): Promise<UniwareSearchHit[]>;
  getReturn(code: string, type: ReturnType): Promise<UniwareReturnDetail>;
  /** For a scanned code with no known type: tries it as a shipment and as a reverse pickup. */
  findReturn(code: string): Promise<UniwareReturnDetail | null>;
  /** Orders cancelled in the last `minutes` minutes. */
  searchCancelledOrders(minutes: number): Promise<UniwareOrderHit[]>;
  getSaleOrder(code: string): Promise<UniwareSaleOrder>;
}

export class UniwareError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly retryable = false,
    /** How long Uniware asked us to wait before retrying (429 Retry-After). */
    readonly retryAfterMs: number | null = null
  ) {
    super(message);
  }
}
