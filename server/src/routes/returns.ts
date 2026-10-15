import { Router } from 'express';
import { z } from 'zod';

import { ALL_STAGES, ClockMode, type ClientsResponse, type LookupResponse, MOVEMENT_KINDS, RETURN_TYPES, ReturnSort } from '@hexabuild/shared';

import { scopeQuery } from '../lib/scope.ts';
import { getPipeline, getReturnDetail, listClients, listReturns } from '../repo/returnsRepo.ts';
import type { SyncService } from '../sync/syncService.ts';

const listQuery = scopeQuery.extend({
  movement: z.enum(MOVEMENT_KINDS).optional(),
  putawayPending: z.stringbool().optional(),
  processed: z.stringbool().optional(),
  stage: z.enum(ALL_STAGES).optional(),
  type: z.enum(RETURN_TYPES).optional(),
  sort: z.enum([ReturnSort.STAGE_AGE, ReturnSort.RECENT]).default(ReturnSort.STAGE_AGE),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const pipelineQuery = scopeQuery.extend({
  type: z.enum(RETURN_TYPES).optional(),
  clock: z.enum([ClockMode.WORKING, ClockMode.ALL]).default(ClockMode.WORKING),
});

const scannedCode = z.string().trim().min(3).max(64);

export function returnsRouter(sync: SyncService) {
  const router = Router();

  router.get('/returns', (req, res) => {
    const filters = listQuery.parse(req.query);

    res.json(listReturns(filters));
  });

  router.get('/returns/:id', (req, res) => {
    const detail = getReturnDetail(req.params.id);

    if (!detail) {
      res.status(404).json({ error: 'Return not found' });
      return;
    }

    res.json(detail);
  });

  router.get('/pipeline', (req, res) => {
    const { type, clock, ...scope } = pipelineQuery.parse(req.query);

    res.json(getPipeline(type, clock, scope));
  });

  router.get('/clients', (_req, res) => {
    const body: ClientsResponse = { clients: listClients() };

    res.json(body);
  });

  // A worker scanned a label: find the return locally, or fetch it from Uniware.
  router.get('/lookup/:code', async (req, res) => {
    const code = scannedCode.parse(req.params.code);

    const found = await sync.lookup(code);

    const body: LookupResponse = found
      ? { found: true, source: found.fromUniware ? 'uniware' : 'local', data: getReturnDetail(found.id) }
      : { found: false, source: null, data: null };

    res.json(body);
  });

  return router;
}
