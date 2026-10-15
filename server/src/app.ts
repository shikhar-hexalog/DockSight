import express, { type ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

import { aiRouter } from './routes/ai.ts';
import { demoRouter } from './routes/demo.ts';
import { dispatchRouter } from './routes/dispatch.ts';
import { receivingRouter } from './routes/receiving.ts';
import { remoteRouter } from './routes/remote.ts';
import { reportsRouter } from './routes/reports.ts';
import { returnsRouter } from './routes/returns.ts';
import { syncRouter } from './routes/sync.ts';
import { workflowRouter } from './routes/workflow.ts';
import type { DispatchGuard } from './sync/dispatchGuard.ts';
import type { SyncService } from './sync/syncService.ts';
import { UniwareError } from './uniware/types.ts';

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: err.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') });
    return;
  }

  if (err instanceof UniwareError) {
    res.status(502).json({ error: `Uniware: ${err.message}` });
    return;
  }

  console.error(err);

  res.status(500).json({ error: 'Something went wrong' });
};

export function createApp(sync: SyncService, guard: DispatchGuard) {
  const app = express();

  // Large enough for a label photo sent to the AI.
  // Room for a few desk photos per request.
  app.use(express.json({ limit: '40mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api', returnsRouter(sync));

  app.use('/api', syncRouter(sync));

  app.use('/api', receivingRouter(sync));

  app.use('/api', reportsRouter(guard));

  app.use('/api', dispatchRouter(guard));

  app.use('/api', aiRouter(guard));

  app.use('/api', demoRouter());

  app.use('/api', remoteRouter());

  app.use('/api', workflowRouter());

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(errorHandler);

  return app;
}
