// Demo support: stage a cancelled-after-manifest order so the dispatch STOP
// can be shown on cue. Demo holds are stored under DEMO_ACCOUNT and can be
// cleared in one go.

import { randomInt } from 'node:crypto';

import { Router } from 'express';

import { DEMO_ACCOUNT, type DemoCancellationResponse } from '@hexabuild/shared';

import { db } from '../db/index.ts';
import { nowIso } from '../lib/time.ts';
import { upsertHold } from '../repo/dispatchRepo.ts';

const digits = (length: number) => Array.from({ length }, () => randomInt(10)).join('');

export function demoRouter() {
  const router = Router();
  // Stages one cancelled-after-manifest order, as the guard would raise it.
  router.post('/demo/cancellation', (_req, res) => {
    const code = digits(12);

    const now = nowIso();

    upsertHold({
      account: DEMO_ACCOUNT,
      saleOrderCode: `DEMO-SO-${digits(5)}`,
      packageCode: `DEMO-SP-${digits(5)}`,
      trackingNumber: code,
      manifestCode: `DEMO-MANIFEST-${now.slice(0, 10)}`,
      courier: 'Delhivery',
      itemCount: 1,
      firstItemName: 'Demo item',
      cancellationReason: 'Customer cancelled (demo)',
      cancelledAt: now,
      dispatchedAt: null,
    });

    const body: DemoCancellationResponse = { code };

    res.status(201).json(body);
  });

  router.delete('/demo/cancellations', (_req, res) => {
    const { changes } = db.prepare('DELETE FROM dispatch_holds WHERE account = ?').run(DEMO_ACCOUNT);

    res.json({ removed: Number(changes) });
  });

  return router;
}
