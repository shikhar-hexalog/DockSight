import { Router } from 'express';
import { z } from 'zod';

import { SyncKind } from '@hexabuild/shared';

import { SyncBusyError, type SyncService } from '../sync/syncService.ts';

const runBody = z.object({
  kind: z.enum([SyncKind.INCREMENTAL, SyncKind.BACKFILL]).default(SyncKind.INCREMENTAL),
});

export function syncRouter(sync: SyncService) {
  const router = Router();

  router.get('/sync/status', (_req, res) => {
    res.json(sync.status());
  });

  // Starts a sync and returns at once; the UI polls /sync/status for progress.
  router.post('/sync/run', (req, res) => {
    const { kind } = runBody.parse(req.body ?? {});

    if (sync.status().running) {
      res.status(409).json({ error: new SyncBusyError().message });
      return;
    }

    const run = kind === SyncKind.BACKFILL ? sync.backfill() : sync.incremental();

    run.catch(err => {
      if (!(err instanceof SyncBusyError)) {
        console.error(`[sync] manual ${kind} failed: ${(err as Error).message}`);
      }
    });

    res.status(202).json(sync.status());
  });

  return router;
}
