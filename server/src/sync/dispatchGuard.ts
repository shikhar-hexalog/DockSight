// The cancellation guard. Every few minutes, for each Uniware account:
//
// 1. Fetch orders cancelled since the last check (with some overlap).
// 2. For each, look at its packages: one that is on a manifest and was not
//    dispatched before the cancellation becomes a hold ("pull this out").
// 3. Re-check open holds: if Uniware now shows one dispatched, it was missed.
//
// Read-only: Uniware is never changed. The hold tells people to act.

import type { GuardStatus } from '@hexabuild/shared';

import { config } from '../config.ts';
import { mapWithLimit } from '../lib/async.ts';
import { MINUTE_MS, toIso } from '../lib/time.ts';
import { type HoldCandidate, listOpenHolds, upsertHold } from '../repo/dispatchRepo.ts';
import { SaleOrderStatus, type UniwareSaleOrder } from '../uniware/types.ts';
import type { SyncSource } from './syncService.ts';

// How far back the first check looks after the server starts.
const FIRST_LOOKBACK_MINUTES = 180;

// Each later check re-reads a little more than the gap since the last one.
const OVERLAP_MINUTES = 3;

const CANCELLED_ITEM = 'CANCELLED';

/** Cancelled packages of an order that were on a manifest and not dispatched before the cancellation. */
export function holdCandidates(account: string, order: UniwareSaleOrder): HoldCandidate[] {
  if (order.status !== SaleOrderStatus.CANCELLED || !order.code) {
    return [];
  }

  const items = order.saleOrderItems ?? [];

  const orderUpdated = toIso(order.updated ?? null);

  return (order.shippingPackages ?? []).flatMap(pkg => {
    if (!pkg.code || !pkg.shippingManifestCode) {
      return [];
    }

    const packageItems = items.filter(item => item.shippingPackageCode === pkg.code);

    const cancelledItem = packageItems.find(item => item.statusCode === CANCELLED_ITEM);

    const cancelledAt = toIso(cancelledItem?.updated ?? null) ?? orderUpdated;

    const dispatchedAt = toIso(pkg.dispatched ?? null);

    // Cancelled after it left: nothing to pull, it's an ordinary return now.
    if (!cancelledAt || (dispatchedAt && dispatchedAt < cancelledAt)) {
      return [];
    }

    return [
      {
        account,
        saleOrderCode: order.code!,
        packageCode: pkg.code,
        trackingNumber: pkg.trackingNumber ?? null,
        manifestCode: pkg.shippingManifestCode,
        courier: pkg.shippingProvider ?? null,
        itemCount: packageItems.length,
        firstItemName: packageItems[0]?.itemName ?? packageItems[0]?.itemSku ?? null,
        cancellationReason: cancelledItem?.cancellationReason ?? null,
        cancelledAt,
        dispatchedAt,
      },
    ];
  });
}

export class DispatchGuard {
  private timer: NodeJS.Timeout | null = null;

  private running = false;

  private lastRunAt: Date | null = null;

  private lastError: string | null = null;

  constructor(private readonly sources: SyncSource[]) {}

  start() {
    void this.run();

    this.timer = setInterval(() => void this.run(), config.guard.intervalMinutes * MINUTE_MS);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  status(): GuardStatus {
    return {
      lastRunAt: this.lastRunAt?.toISOString() ?? null,
      lastError: this.lastError,
      intervalMinutes: config.guard.intervalMinutes,
    };
  }

  async run() {
    if (this.running) {
      return;
    }

    this.running = true;

    const startedAt = new Date();

    const lookback = this.lastRunAt
      ? Math.ceil((startedAt.getTime() - this.lastRunAt.getTime()) / MINUTE_MS) + OVERLAP_MINUTES
      : FIRST_LOOKBACK_MINUTES;

    const errors: string[] = [];

    try {
      for (const { account, client } of this.sources) {
        try {
          const hits = await client.searchCancelledOrders(lookback);

          const codes = new Set(hits.map(hit => hit.code));

          // Open holds are re-checked so ones dispatched anyway become "missed".
          for (const hold of listOpenHolds().filter(h => h.account === account.key)) {
            codes.add(hold.saleOrderCode);
          }

          await mapWithLimit([...codes], config.uniware.maxConcurrency, async code => {
            const order = await client.getSaleOrder(code);

            for (const candidate of holdCandidates(account.key, order)) {
              upsertHold(candidate);
            }
          });
        } catch (err) {
          errors.push(`${account.key}: ${(err as Error).message}`);
        }
      }

      this.lastRunAt = startedAt;

      this.lastError = errors[0] ?? null;

      if (errors.length > 0) {
        console.error(`[guard] ${errors.join('; ')}`);
      }
    } finally {
      this.running = false;
    }
  }
}
