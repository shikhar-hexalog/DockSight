import { UniwareMode } from '@hexabuild/shared';

import { BriefScheduler } from './ai/briefScheduler.ts';
import { createApp } from './app.ts';
import { config } from './config.ts';
import { migrate } from './db/index.ts';
import { startDispatchEmailRetry } from './notify/dispatchEmails.ts';
import { DispatchGuard } from './sync/dispatchGuard.ts';
import { SyncService } from './sync/syncService.ts';
import { createSyncSources, describeSources } from './uniware/index.ts';

migrate();

const sources = createSyncSources();

const sync = new SyncService(sources);

const guard = new DispatchGuard(sources);

const briefs = new BriefScheduler(() => guard.status());

const app = createApp(sync, guard);

let stopEmailRetry = () => {};

// 0.0.0.0 so phones on the same Wi-Fi can reach it.
const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`[server] http://localhost:${config.port}`);

  for (const line of describeSources()) {
    console.log(`[server] ${line}`);
  }

  // Import mode has nothing to poll: data arrives through npm run import.
  if (config.uniware.mode !== UniwareMode.IMPORT) {
    void sync.start();

    guard.start();
  }

  briefs.start();

  stopEmailRetry = startDispatchEmailRetry();
});

function shutdown() {
  sync.stop();
  guard.stop();
  briefs.stop();
  stopEmailRetry();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);

process.on('SIGTERM', shutdown);
