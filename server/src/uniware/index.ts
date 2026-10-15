import { UniwareMode } from '@hexabuild/shared';

import { type UniwareAccount, config } from '../config.ts';
import type { SyncSource } from '../sync/syncService.ts';
import { LiveUniwareClient } from './liveClient.ts';
import { MockUniwareClient } from './mockClient.ts';
import type { UniwareClient } from './types.ts';

function createUniwareClient(account: UniwareAccount): UniwareClient {
  if (config.uniware.mode === UniwareMode.LIVE) {
    return new LiveUniwareClient(account);
  }

  return new MockUniwareClient();
}

/** One client per configured account (or the single mock account). */
export function createSyncSources(): SyncSource[] {
  return config.uniware.accounts.map(account => ({ account, client: createUniwareClient(account) }));
}

/** Startup log line: which accounts will sync, and which are skipped and why. */
export function describeSources(): string[] {
  const skipped = config.uniware.incompleteAccounts.map(a => `Skipping account ${a.key}: missing ${a.missing.join(', ')}`);

  if (config.uniware.mode === UniwareMode.MOCK) {
    return ['MOCK data (no complete UNICOMMERCE_ACCOUNT_* in .env)', ...skipped];
  }

  if (config.uniware.mode === UniwareMode.IMPORT) {
    return ['IMPORT mode: no live sync; load Uniware exports with npm run import -- <file.csv>'];
  }

  const ready = config.uniware.accounts.map(a => `Uniware account ${a.key}: ${a.baseUrl}, facility ${a.facility}`);

  return [...ready, ...skipped];
}
