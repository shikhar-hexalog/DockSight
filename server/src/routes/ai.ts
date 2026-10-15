import { Router } from 'express';
import { z } from 'zod';

import { type AiStatusResponse, BriefKind, BriefTrigger, type BriefsResponse } from '@hexabuild/shared';

import { briefSchedule } from '../ai/briefScheduler.ts';
import { readLabel } from '../ai/labelReader.ts';
import { ai } from '../ai/provider.ts';
import { askData, generateBrief, listBriefs } from '../ai/reporting.ts';
import { AiError } from '../ai/types.ts';
import type { DispatchGuard } from '../sync/dispatchGuard.ts';

const briefBody = z.object({
  kind: z.enum([BriefKind.DAILY, BriefKind.HANDOVER]),
});

const briefsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const askBody = z.object({
  question: z.string().trim().min(3).max(500),
});

const ACCEPTED_IMAGES = ['image/jpeg', 'image/png', 'image/webp'] as const;

// About 7 MB once decoded: plenty for a label photo.
const MAX_IMAGE_BASE64 = 10_000_000;

const labelBody = z.object({
  mimeType: z.enum(ACCEPTED_IMAGES),
  imageBase64: z.string().min(100).max(MAX_IMAGE_BASE64),
});

export function aiRouter(guard: DispatchGuard) {
  const router = Router();

  router.get('/ai/status', (_req, res) => {
    const body: AiStatusResponse = {
      provider: ai.name,
      dailyAt: briefSchedule.dailyAt.join(', '),
      handoverAt: briefSchedule.handoverAt,
      webhookConfigured: Boolean(process.env.BRIEF_WEBHOOK_URL?.trim()),
    };

    res.json(body);
  });

  router.get('/briefs', (req, res) => {
    const { limit } = briefsQuery.parse(req.query);

    const body: BriefsResponse = { data: listBriefs(limit) };

    res.json(body);
  });

  router.post('/briefs', async (req, res) => {
    const { kind } = briefBody.parse(req.body);

    try {
      res.json(await generateBrief(kind, BriefTrigger.MANUAL, guard.status()));
    } catch (err) {
      res.status(502).json({ error: err instanceof AiError ? err.message : 'Could not write the brief' });
    }
  });

  router.post('/ask', async (req, res) => {
    const { question } = askBody.parse(req.body);

    try {
      res.json(await askData(question, guard.status()));
    } catch (err) {
      res.status(502).json({ error: err instanceof AiError ? err.message : 'Could not answer' });
    }
  });

  router.post('/desk/read-label', async (req, res) => {
    const { mimeType, imageBase64 } = labelBody.parse(req.body);

    try {
      res.json(await readLabel(Buffer.from(imageBase64, 'base64'), mimeType));
    } catch (err) {
      res.status(502).json({ error: err instanceof AiError ? err.message : 'Could not read the label' });
    }
  });

  return router;
}
