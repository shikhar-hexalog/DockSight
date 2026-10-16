import { Router } from 'express';
import { z } from 'zod';

import {
  type DispatchHoldsResponse,
  type DispatchNoticesResponse,
  type HandoverCheckResult,
  type HandoverChecksResponse,
  HandoverResult,
  PulledVia,
} from '@hexabuild/shared';

import { config } from '../config.ts';
import { nowIso } from '../lib/time.ts';
import { listDispatchNotices, notifyHandover } from '../notify/handoverEmails.ts';
import { listHolds, pullHold, recordHandoverCheck } from '../repo/dispatchRepo.ts';
import type { DispatchGuard } from '../sync/dispatchGuard.ts';

const MAX_BATCH = 500;

const holdsQuery = z.object({
  since: z.iso.datetime().optional(),
});

const pullBody = z.object({
  pulledBy: z.string().trim().min(1).max(60),
});

const checkSchema = z.object({
  id: z.uuid(),
  code: z.string().trim().min(3).max(64),
  checkedBy: z.string().trim().min(1).max(60),
  checkedAt: z.iso.datetime(),
  batchId: z.uuid().optional(),
});

// Each check is validated on its own so one bad entry can't block the rest.
const checksBody = z.object({ checks: z.array(z.unknown()).min(1).max(MAX_BATCH) });

function startOfToday(): string {
  const start = new Date();

  start.setHours(0, 0, 0, 0);

  return start.toISOString();
}

function invalidCheck(raw: unknown): HandoverCheckResult {
  const value = (raw ?? {}) as { id?: unknown; code?: unknown };

  return {
    id: typeof value.id === 'string' ? value.id : 'unknown',
    code: typeof value.code === 'string' ? value.code : '',
    result: HandoverResult.INVALID,
    hold: null,
  };
}

export function dispatchRouter(guard: DispatchGuard) {
  const router = Router();

  router.get('/dispatch/holds', (req, res) => {
    const { since } = holdsQuery.parse(req.query);

    const body: DispatchHoldsResponse = { data: listHolds(since ?? startOfToday()) };

    res.json(body);
  });

  // Customer emails sent for today's submitted handovers, newest first.
  router.get('/dispatch/notices', (req, res) => {
    const { since } = holdsQuery.parse(req.query);

    const body: DispatchNoticesResponse = { data: listDispatchNotices(since ?? startOfToday()), inboxUrl: config.mail.inboxUrl };

    res.json(body);
  });

  router.post('/dispatch/holds/:id/pull', (req, res) => {
    const { pulledBy } = pullBody.parse(req.body);

    const hold = pullHold(req.params.id, pulledBy, PulledVia.MANUAL, nowIso());

    if (!hold) {
      res.status(404).json({ error: 'Hold not found' });
      return;
    }

    res.json(hold);
  });

  router.post('/dispatch/checks', (req, res) => {
    const { checks } = checksBody.parse(req.body);

    const handovers = new Set<string>();

    const results = checks.map(raw => {
      const parsed = checkSchema.safeParse(raw);

      if (!parsed.success) {
        return invalidCheck(raw);
      }

      if (parsed.data.batchId) {
        handovers.add(parsed.data.batchId);
      }

      return recordHandoverCheck(parsed.data);
    });

    // Scans can reach the server after their handover was submitted: email those customers too.
    // notifyHandover ignores handovers that aren't submitted yet.
    setImmediate(() => {
      for (const batchId of handovers) {
        void notifyHandover(batchId).catch(err => console.error('[mail] dispatch emails failed:', err));
      }
    });

    const body: HandoverChecksResponse = { results };

    res.json(body);
  });

  // Check Uniware for new cancellations now, instead of waiting for the next run.
  router.post('/dispatch/guard/run', async (_req, res) => {
    await guard.run();

    res.json(guard.status());
  });

  return router;
}
