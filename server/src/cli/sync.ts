// One-off sync from the command line:
//   npm run sync               catch every account up (backfills new ones)
//   npm run sync -- backfill   reload the last BACKFILL_DAYS for every account

import { migrate } from '../db/index.ts';
import { getPipeline } from '../repo/returnsRepo.ts';
import { SyncService } from '../sync/syncService.ts';
import { createSyncSources, describeSources } from '../uniware/index.ts';

const BACKFILL_ARG = 'backfill';

migrate();

for (const line of describeSources()) {
  console.log(`[sync] ${line}`);
}

const sync = new SyncService(createSyncSources());

try {
  if (process.argv.includes(BACKFILL_ARG)) {
    await sync.backfill();
  } else {
    await sync.incremental();
  }

  const pipeline = getPipeline();

  console.log(`\n${pipeline.total} returns in the database`);

  console.table(pipeline.stages);
} catch (err) {
  console.error(`[sync] failed: ${(err as Error).message}`);
  process.exitCode = 1;
}
