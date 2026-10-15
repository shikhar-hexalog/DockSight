// The desk's own storage. Every scan is written here first, so nothing is
// lost if the network drops or the browser is closed mid-shift.

import { type DBSchema, type IDBPDatabase, openDB } from 'idb';

import { BatchKind } from '@hexabuild/shared';
import type { BatchStart, DeskOp, DeskReturn, ParcelCondition, ReceiveScan, ReturnType, ScanResult } from '@hexabuild/shared';

/** One scan as the desk shows it: the instant local answer, then the server's. */
export interface DeskScanEntry {
  id: string;
  code: string;
  scannedAt: string;
  scannedBy: string;
  result: ScanResult;
  returnId: string | null;
  sourceCode: string | null;
  type: ReturnType | null;
  courier: string | null;
  saleOrderCode: string | null;
  reversePickupCode: string | null;
  firstItemName: string | null;
  itemCount: number | null;
  /** Previous dock scan of the same parcel, for "already scanned" messages. */
  earlierScanAt: string | null;
  earlierScanBy: string | null;
  synced: boolean;
  /** The receiving batch (courier handover) it was scanned in. */
  batchId: string | null;
  condition: ParcelCondition | null;
  conditionNote: string | null;
  hasPhoto: boolean;
}

/** A desk action waiting to be sent, in the order it happened. */
export interface QueuedOp {
  seq: number;
  op: DeskOp;
}

interface DeskDb extends DBSchema {
  returns: { key: string; value: DeskReturn };
  outbox: { key: string; value: ReceiveScan };
  log: { key: string; value: DeskScanEntry; indexes: { byTime: string } };
  meta: { key: string; value: string };
  ops: { key: number; value: QueuedOp };
  batch: { key: string; value: BatchStart };
}

const DB_NAME = 'hexabuild-desk';

const MANIFEST_AT = 'manifestAt';

let dbPromise: Promise<IDBPDatabase<DeskDb>> | null = null;

function getDb() {
  dbPromise ??= openDB<DeskDb>(DB_NAME, 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('returns', { keyPath: 'id' });
        db.createObjectStore('outbox', { keyPath: 'id' });
        db.createObjectStore('log', { keyPath: 'id' }).createIndex('byTime', 'scannedAt');
        db.createObjectStore('meta');
      }

      if (oldVersion < 2) {
        db.createObjectStore('ops', { keyPath: 'seq', autoIncrement: true });
        // The open batch on this desk (at most one), kept across reloads.
        db.createObjectStore('batch', { keyPath: 'id' });
      }
    },
  });

  return dbPromise;
}

export async function loadReturns(): Promise<DeskReturn[]> {
  return (await getDb()).getAll('returns');
}

/** Replaces the cached list with the server's latest. */
export async function saveManifest(returns: DeskReturn[], generatedAt: string) {
  const db = await getDb();

  const tx = db.transaction(['returns', 'meta'], 'readwrite');

  await tx.objectStore('returns').clear();

  await Promise.all(returns.map(r => tx.objectStore('returns').put(r)));

  await tx.objectStore('meta').put(generatedAt, MANIFEST_AT);

  await tx.done;
}

export async function loadManifestAt(): Promise<string | null> {
  return (await (await getDb()).get('meta', MANIFEST_AT)) ?? null;
}

/** Saves a scan to the outbox and the log in one go. */
export async function saveScan(scan: ReceiveScan, entry: DeskScanEntry) {
  const db = await getDb();

  const tx = db.transaction(['outbox', 'log'], 'readwrite');

  await tx.objectStore('outbox').put(scan);

  await tx.objectStore('log').put(entry);

  await tx.done;
}

/** Scans not yet confirmed by the server, oldest first. */
export async function loadOutbox(): Promise<ReceiveScan[]> {
  const scans = await (await getDb()).getAll('outbox');

  return scans.sort((a, b) => a.scannedAt.localeCompare(b.scannedAt));
}

/** Removes sent scans and records the server's answer for each. */
export async function completeScans(entries: DeskScanEntry[]) {
  const db = await getDb();

  const tx = db.transaction(['outbox', 'log'], 'readwrite');

  for (const entry of entries) {
    await tx.objectStore('outbox').delete(entry.id);

    // A tag added while the scan was on its way is newer than the server's answer.
    const stored = await tx.objectStore('log').get(entry.id);

    const tag = stored ? { condition: stored.condition, conditionNote: stored.conditionNote, hasPhoto: stored.hasPhoto } : {};

    await tx.objectStore('log').put({ ...entry, ...tag });
  }

  await tx.done;
}

export async function deleteScan(entryId: string) {
  const db = await getDb();

  const tx = db.transaction(['outbox', 'log'], 'readwrite');

  await tx.objectStore('outbox').delete(entryId);
  await tx.objectStore('log').delete(entryId);

  await tx.done;
}

export async function loadLogSince(since: string): Promise<DeskScanEntry[]> {
  const entries = await (await getDb()).getAllFromIndex('log', 'byTime', IDBKeyRange.lowerBound(since));

  return entries.reverse();
}

/** Queues a desk action (batch start, tag, submit) to send after the scans. */
export async function queueOp(op: DeskOp) {
  await (await getDb()).add('ops', { op } as QueuedOp);
}

export async function loadOps(): Promise<QueuedOp[]> {
  return (await getDb()).getAll('ops');
}

export async function removeOps(seqs: number[]) {
  const db = await getDb();

  const tx = db.transaction('ops', 'readwrite');

  await Promise.all(seqs.map(seq => tx.store.delete(seq)));

  await tx.done;
}

/** The open handover of each kind on this desk (receiving, dispatch), kept across reloads. */
export async function loadOpenBatches(): Promise<BatchStart[]> {
  // Batches saved before dispatch handovers existed are receiving ones.
  return (await (await getDb()).getAll('batch')).map(b => ({ ...b, batchKind: b.batchKind ?? BatchKind.RECEIVE }));
}

export async function saveOpenBatch(kind: BatchKind, batch: BatchStart | null) {
  const db = await getDb();

  const tx = db.transaction('batch', 'readwrite');

  for (const existing of await tx.store.getAll()) {
    if ((existing.batchKind ?? BatchKind.RECEIVE) === kind) {
      await tx.store.delete(existing.id);
    }
  }

  if (batch) {
    await tx.store.put(batch);
  }

  await tx.done;
}

/** Whether a scan is still waiting to be sent (then removing it needs no message to the server). */
export async function isScanQueued(id: string): Promise<boolean> {
  return (await (await getDb()).get('outbox', id)) !== undefined;
}

export async function updateLogEntry(entry: DeskScanEntry) {
  await (await getDb()).put('log', entry);
}
