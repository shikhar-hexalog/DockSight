import { type Response, Router } from 'express';
import { z } from 'zod';

import { type ManifestDetailResponse, type ManifestsResponse, MatchVerdict, QC_REASONS, QcGrade, type QcRecentResponse } from '@hexabuild/shared';

import { checkProduct } from '../ai/productCheck.ts';
import { AiError } from '../ai/types.ts';
import { DAY_MS } from '../lib/time.ts';
import { WorkflowError, getManifest, listManifests, lookupForQc, manifestParcels, recentQc, submitQc } from '../repo/workflowRepo.ts';

const RECENT_DAYS = 2;

const RECENT_QC_LIMIT = 50;

const person = z.string().trim().min(1).max(60);

const codeQuery = z.object({ code: z.string().trim().min(3).max(64) });

const verdict = z.enum(MatchVerdict);

const aiCheck = z.object({
  verdict,
  items: z.array(z.object({ code: z.string(), verdict, expected: z.string().max(200), observed: z.string().max(200) })).max(50),
  note: z.string().max(400),
  seconds: z.number().min(0),
});

const qcBody = z.object({
  returnId: z.string().min(1),
  qcBy: person,
  shelfCode: z.string().trim().min(1).max(40),
  items: z
    .array(
      z
        .object({ code: z.string().min(1), grade: z.enum(QcGrade), reason: z.enum(QC_REASONS).nullable() })
        // A bad item needs a reason; a good one has none.
        .refine(item => (item.grade === QcGrade.BAD) === (item.reason !== null), { message: 'Bad items need a reason; good items have none' })
    )
    .min(1)
    .max(50),
  photo: z.string().startsWith('data:').nullable(),
  aiCheck: aiCheck.nullable(),
});

const checkBody = z.object({ returnId: z.string().min(1), photo: z.string().startsWith('data:') });

const recentSince = () => new Date(Date.now() - RECENT_DAYS * DAY_MS).toISOString();

/** Rule breaks (already QC'd, never received) are the person's to fix: say why. */
function sendWorkflowError(res: Response, err: unknown): boolean {
  if (err instanceof WorkflowError) {
    res.status(409).json({ error: err.message });
    return true;
  }

  return false;
}

export function workflowRouter() {
  const router = Router();

  // Manifests are made when a receiving handover is submitted; here they're only read.
  router.get('/manifests', (_req, res) => {
    const body: ManifestsResponse = { data: listManifests(recentSince()) };

    res.json(body);
  });

  router.get('/manifests/:id', (req, res) => {
    const manifest = getManifest(req.params.id);

    if (!manifest) {
      res.status(404).json({ error: 'Manifest not found' });
      return;
    }

    const body: ManifestDetailResponse = { manifest, parcels: manifestParcels(manifest.id) };

    res.json(body);
  });

  router.get('/qc/lookup', (req, res) => {
    res.json(lookupForQc(codeQuery.parse(req.query).code));
  });

  router.get('/qc/recent', (_req, res) => {
    const body: QcRecentResponse = { data: recentQc(recentSince(), RECENT_QC_LIMIT) };

    res.json(body);
  });

  router.post('/qc', (req, res) => {
    try {
      res.json(submitQc(qcBody.parse(req.body)));
    } catch (err) {
      if (!sendWorkflowError(res, err)) throw err;
    }
  });

  router.post('/qc/check', async (req, res) => {
    const { returnId, photo } = checkBody.parse(req.body);

    try {
      res.json(await checkProduct(returnId, photo));
    } catch (err) {
      if (err instanceof AiError) {
        res.status(503).json({ error: err.message });
        return;
      }

      throw err;
    }
  });

  return router;
}
