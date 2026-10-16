// Offline-first state for the receiving desk.
//
// A scan is answered instantly from the cached list of expected returns
// (the same classifyScan() the server uses), saved to the browser's own
// storage, and sent to the server in the background. The server's answer
// replaces the instant one when it arrives; it can differ, e.g. when an
// unknown code turns out to be a return Uniware hadn't synced yet.

import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import {
  BatchKind,
  type BatchStart,
  type DeskOp,
  DeskOpKind,
  type DeskReturn,
  type ParcelCondition,
  type Receipt,
  type ReceiveScan,
  ScanResult,
  classifyScan,
  normalizeCode,
} from '@hexabuild/shared';

import { api } from '@/lib/api';

import {
  type DeskScanEntry,
  completeScans,
  deleteScan,
  loadLogSince,
  loadManifestAt,
  isScanQueued,
  loadOpenBatches,
  loadOps,
  loadOutbox,
  loadReturns,
  queueOp,
  removeOps,
  saveManifest,
  saveOpenBatch,
  saveScan,
  updateLogEntry,
} from './localDb';
import { uuid } from './uuid';

export const Connection = {
  ONLINE: 'online',
  OFFLINE: 'offline',
  SYNCING: 'syncing',
} as const;

export type Connection = (typeof Connection)[keyof typeof Connection];

const SYNC_INTERVAL_MS = 10_000;

const BATCH_SIZE = 200;

// Ops can carry photos; a few per request keeps each one small.
const OPS_PER_REQUEST = 5;

// The server says this when an op arrives before what it depends on: try again later.
const RETRY_LATER = 'not received yet';

const SCANNER_KEY = 'hexabuild.scanner';

// Results that mean "this parcel is now physically here".
const RECEIVES_PARCEL: ScanResult[] = [ScanResult.MATCHED, ScanResult.CANCELLED_RETURN];

export interface NewBatch {
  batchKind: BatchKind;
  scannedBy: string;
  courier: string;
  vehicleNo: string | null;
}

export interface ConditionTag {
  condition: ParcelCondition | null;
  note: string | null;
  /** A new photo (JPEG data URL); null keeps whatever photo there was. */
  photo: string | null;
}

export interface BatchSubmission {
  courierCount: number;
  signedSheet: string;
}

interface DeskContextValue {
  ready: boolean;
  /** The receiving handover being scanned at this desk, if any. */
  batch: BatchStart | null;
  /** The dispatch handover (courier pickup) being scanned, if any. */
  dispatchBatch: BatchStart | null;
  startBatch: (input: NewBatch) => Promise<void>;
  /**
   * Takes one receiving scan back. Not yet sent: dropped here. Already sent:
   * the server removes it too (and un-receives the return if needed).
   */
  removeScan: (entryId: string) => Promise<void>;
  /** Queues a desk op (sent in order, offline-safe). */
  queueDeskOp: (op: DeskOp) => Promise<void>;
  /** Tags (or untags) one scan's condition. Never blocks scanning. */
  tagScan: (entryId: string, tag: ConditionTag) => Promise<void>;
  submitBatch: (kind: BatchKind, submission: BatchSubmission) => Promise<void>;
  /** Gives up the open handover: its scans are taken back and the next one starts from the courier and vehicle again. */
  discardBatch: (kind: BatchKind) => Promise<void>;
  /** Couriers seen on expected returns, for the delivery partner picker. */
  couriers: string[];
  /** This batch's scans, newest first. */
  batchEntries: DeskScanEntry[];
  connection: Connection;
  lastSyncedAt: string | null;
  pendingCount: number;
  scanner: string | null;
  setScanner: (name: string) => void;
  /** Today's scans at this desk, newest first. */
  log: DeskScanEntry[];
  scan: (code: string) => Promise<DeskScanEntry | null>;
  syncNow: () => void;
}

const DeskContext = createContext<DeskContextValue | null>(null);

function readScanner(): string | null {
  try {
    return localStorage.getItem(SCANNER_KEY);
  } catch {
    return null;
  }
}

function startOfToday(): string {
  const start = new Date();

  start.setHours(0, 0, 0, 0);

  return start.toISOString();
}

/**
 * How far back the desk's list goes: today, or further if a handover is still
 * open from before midnight, so its list, counts and printed sheet stay whole.
 */
async function logStart(): Promise<string> {
  const starts = (await loadOpenBatches()).map(b => b.startedAt);

  return [startOfToday(), ...starts].sort()[0];
}

function buildIndex(returns: Map<string, DeskReturn>): Map<string, string> {
  const index = new Map<string, string>();

  for (const r of returns.values()) {
    for (const code of r.codes) {
      index.set(normalizeCode(code), r.id);
    }
  }

  return index;
}

/** The server's answer, keeping what only the desk knew (item count, earlier scan). */
function mergeReceipt(entry: DeskScanEntry | undefined, receipt: Receipt): DeskScanEntry {
  // A tag set at the desk may be newer than what the server had when it answered.
  return {
    id: receipt.id,
    code: receipt.code,
    scannedAt: receipt.scannedAt,
    scannedBy: receipt.scannedBy,
    result: receipt.result,
    returnId: receipt.returnId,
    sourceCode: receipt.sourceCode,
    type: receipt.type,
    courier: receipt.courier,
    saleOrderCode: receipt.saleOrderCode,
    reversePickupCode: receipt.reversePickupCode,
    firstItemName: receipt.firstItemName,
    itemCount: entry?.itemCount ?? null,
    earlierScanAt: entry?.earlierScanAt ?? null,
    earlierScanBy: entry?.earlierScanBy ?? null,
    synced: true,
    batchId: entry?.batchId ?? receipt.batchId,
    condition: entry ? entry.condition : receipt.condition,
    conditionNote: entry ? entry.conditionNote : receipt.conditionNote,
    hasPhoto: entry?.hasPhoto ?? receipt.conditionPhotoUrl !== null,
  };
}

/** Sends queued ops in order; stops at the first that has to wait. */
async function sendOps(): Promise<void> {
  const queued = await loadOps();

  for (let start = 0; start < queued.length; start += OPS_PER_REQUEST) {
    const chunk = queued.slice(start, start + OPS_PER_REQUEST);

    const { results } = await api.sendOps(chunk.map(q => q.op));

    const done: number[] = [];

    for (const [index, result] of results.entries()) {
      if (!result.ok && result.error?.includes(RETRY_LATER)) {
        await removeOps(done);
        return;
      }

      // Done, or rejected for good (a bad op would block the queue forever).
      done.push(chunk[index].seq);
    }

    await removeOps(done);
  }
}

function classifyLocally(match: DeskReturn | null, dockReceivedAt: string | null, earlier: DeskScanEntry | undefined): ScanResult {
  if (match) {
    return classifyScan({ stage: match.stage, dockReceivedAt });
  }

  // An unknown code this desk already flagged: don't raise it twice.
  return earlier ? ScanResult.ALREADY_RECEIVED : ScanResult.UNEXPECTED;
}

export function DeskProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  const [returns, setReturns] = useState<Map<string, DeskReturn>>(new Map());

  const [log, setLog] = useState<DeskScanEntry[]>([]);

  const [pendingCount, setPendingCount] = useState(0);

  const [connection, setConnection] = useState<Connection>(Connection.ONLINE);

  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const [scanner, setScannerState] = useState<string | null>(readScanner);

  const [openBatches, setOpenBatches] = useState<Record<BatchKind, BatchStart | null>>({
    [BatchKind.RECEIVE]: null,
    [BatchKind.DISPATCH]: null,
  });

  const batch = openBatches[BatchKind.RECEIVE];

  const dispatchBatch = openBatches[BatchKind.DISPATCH];

  const setOpenBatch = useCallback((kind: BatchKind, next: BatchStart | null) => setOpenBatches(prev => ({ ...prev, [kind]: next })), []);

  const flushing = useRef(false);

  const flushAgain = useRef(false);

  const codeIndex = useMemo(() => buildIndex(returns), [returns]);

  const couriers = useMemo(
    () => [...new Set([...returns.values()].map(r => r.courier).filter((c): c is string => Boolean(c)))].sort((a, b) => a.localeCompare(b)),
    [returns]
  );

  const batchEntries = useMemo(() => (batch ? log.filter(e => e.batchId === batch.id) : []), [batch, log]);

  const refreshManifest = useCallback(async () => {
    const manifest = await api.deskManifest();

    await saveManifest(manifest.returns, manifest.generatedAt);

    setReturns(new Map(manifest.returns.map(r => [r.id, r])));

    setLastSyncedAt(manifest.generatedAt);
  }, []);

  /** Sends waiting scans in order, then refreshes the list. One run at a time. */
  const flush = useCallback(async () => {
    if (flushing.current) {
      flushAgain.current = true;
      return;
    }

    flushing.current = true;

    try {
      do {
        flushAgain.current = false;

        const waiting = await loadOutbox();

        if (waiting.length === 0) {
          break;
        }

        setConnection(Connection.SYNCING);

        const batch = waiting.slice(0, BATCH_SIZE);

        const { results } = await api.sendScans(batch);

        const current = new Map((await loadLogSince(await logStart())).map(e => [e.id, e]));

        const confirmed = results.filter(r => batch.some(s => s.id === r.id)).map(r => mergeReceipt(current.get(r.id), r));

        await completeScans(confirmed);

        flushAgain.current ||= waiting.length > batch.length;
      } while (flushAgain.current);

      await sendOps();

      await refreshManifest();

      setConnection(Connection.ONLINE);
    } catch {
      setConnection(Connection.OFFLINE);
    } finally {
      flushing.current = false;

      setPendingCount((await loadOutbox()).length + (await loadOps()).length);

      setLog(await loadLogSince(await logStart()));
    }
  }, [refreshManifest]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [cached, entries, waiting, manifestAt, savedBatches, ops] = await Promise.all([
        loadReturns(),
        logStart().then(loadLogSince),
        loadOutbox(),
        loadManifestAt(),
        loadOpenBatches(),
        loadOps(),
      ]);

      if (cancelled) {
        return;
      }

      setReturns(new Map(cached.map(r => [r.id, r])));

      setLog(entries);

      setPendingCount(waiting.length + ops.length);

      setOpenBatches({
        [BatchKind.RECEIVE]: savedBatches.find(b => b.batchKind === BatchKind.RECEIVE) ?? null,
        [BatchKind.DISPATCH]: savedBatches.find(b => b.batchKind === BatchKind.DISPATCH) ?? null,
      });

      setLastSyncedAt(manifestAt);

      setReady(true);

      void flush();
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [flush]);

  useEffect(() => {
    const timer = setInterval(() => void flush(), SYNC_INTERVAL_MS);

    const onOnline = () => void flush();

    window.addEventListener('online', onOnline);

    return () => {
      clearInterval(timer);
      window.removeEventListener('online', onOnline);
    };
  }, [flush]);

  const scan = useCallback(
    async (rawCode: string): Promise<DeskScanEntry | null> => {
      const code = rawCode.trim();

      if (code.length < 3 || !scanner || !batch) {
        return null;
      }

      const normalized = normalizeCode(code);

      const returnId = codeIndex.get(normalized) ?? null;

      const match = returnId ? (returns.get(returnId) ?? null) : null;

      // This desk may have received it moments ago, before the server knew.
      const earlier = log.find(e => (match ? e.returnId === match.id && RECEIVES_PARCEL.includes(e.result) : normalizeCode(e.code) === normalized));

      const dockReceivedAt = match?.dockReceivedAt ?? earlier?.scannedAt ?? null;

      const localResult = classifyLocally(match, dockReceivedAt, earlier);

      const scanRecord: ReceiveScan = { id: uuid(), code, scannedBy: scanner, scannedAt: new Date().toISOString(), batchId: batch.id };

      const entry: DeskScanEntry = {
        id: scanRecord.id,
        code,
        scannedAt: scanRecord.scannedAt,
        scannedBy: scanner,
        result: localResult,
        returnId: match?.id ?? null,
        sourceCode: match?.sourceCode ?? null,
        type: match?.type ?? null,
        courier: match?.courier ?? null,
        saleOrderCode: match?.saleOrderCode ?? null,
        reversePickupCode: match?.reversePickupCode ?? null,
        firstItemName: match?.firstItemName ?? null,
        itemCount: match?.itemCount ?? null,
        earlierScanAt: match?.dockReceivedAt ?? earlier?.scannedAt ?? null,
        earlierScanBy: match?.dockReceivedBy ?? earlier?.scannedBy ?? null,
        synced: false,
        batchId: batch.id,
        condition: null,
        conditionNote: null,
        hasPhoto: false,
      };

      await saveScan(scanRecord, entry);

      setLog(prev => [entry, ...prev]);

      setPendingCount(count => count + 1);

      void flush();

      return entry;
    },
    [scanner, batch, codeIndex, returns, log, flush]
  );

  const setScanner = useCallback((name: string) => {
    try {
      localStorage.setItem(SCANNER_KEY, name);
    } catch {
      // Private mode: keep it for this session only.
    }

    setScannerState(name);
  }, []);

  const enqueue = useCallback(
    async (op: DeskOp) => {
      await queueOp(op);

      setPendingCount(count => count + 1);

      void flush();
    },
    [flush]
  );

  const startBatch = useCallback(
    async (input: NewBatch) => {
      const started: BatchStart = { id: uuid(), ...input, startedAt: new Date().toISOString() };

      await saveOpenBatch(input.batchKind, started);

      setOpenBatch(input.batchKind, started);

      setScanner(input.scannedBy);

      await enqueue({ kind: DeskOpKind.BATCH_START, ...started });
    },
    [enqueue, setScanner, setOpenBatch]
  );

  const removeScan = useCallback(
    async (entryId: string) => {
      const entry = log.find(e => e.id === entryId);

      if (!entry) {
        return;
      }

      const queued = await isScanQueued(entryId);

      await deleteScan(entryId);

      setLog(prev => prev.filter(e => e.id !== entryId));

      if (queued) {
        // Never reached the server: dropping it here is enough.
        setPendingCount(count => Math.max(0, count - 1));
        return;
      }

      await enqueue({
        kind: DeskOpKind.SCAN_REMOVE,
        id: uuid(),
        scanId: entryId,
        removedBy: scanner ?? entry.scannedBy,
        removedAt: new Date().toISOString(),
      });
    },
    [enqueue, log, scanner]
  );

  const tagScan = useCallback(
    async (entryId: string, tag: ConditionTag) => {
      const entry = log.find(e => e.id === entryId);

      if (!entry) {
        return;
      }

      const updated: DeskScanEntry = {
        ...entry,
        condition: tag.condition,
        conditionNote: tag.condition ? tag.note : null,
        hasPhoto: tag.condition ? entry.hasPhoto || tag.photo !== null : false,
      };

      await updateLogEntry(updated);

      setLog(prev => prev.map(e => (e.id === entryId ? updated : e)));

      await enqueue({
        kind: DeskOpKind.CONDITION,
        id: uuid(),
        scanId: entryId,
        condition: tag.condition,
        note: updated.conditionNote,
        photo: tag.condition ? tag.photo : null,
        updatedAt: new Date().toISOString(),
      });
    },
    [log, enqueue]
  );

  const submitBatch = useCallback(
    async (kind: BatchKind, submission: BatchSubmission) => {
      const open = openBatches[kind];

      if (!open || !scanner) {
        return;
      }

      await enqueue({
        kind: DeskOpKind.BATCH_SUBMIT,
        id: uuid(),
        batchId: open.id,
        ...submission,
        submittedBy: scanner,
        submittedAt: new Date().toISOString(),
      });

      await saveOpenBatch(kind, null);

      setOpenBatch(kind, null);
    },
    [openBatches, scanner, enqueue, setOpenBatch]
  );

  const discardBatch = useCallback(
    async (kind: BatchKind) => {
      const open = openBatches[kind];

      if (!open) {
        return;
      }

      if (kind === BatchKind.RECEIVE) {
        const entries = log.filter(e => e.batchId === open.id);

        const wasQueued = await Promise.all(entries.map(e => isScanQueued(e.id)));

        for (const entry of entries) {
          await deleteScan(entry.id);
        }

        setLog(prev => prev.filter(e => e.batchId !== open.id));

        // Scans that never left this desk are simply dropped; the rest the server takes back with the handover.
        setPendingCount(count => Math.max(0, count - wasQueued.filter(Boolean).length));
      }

      await enqueue({
        kind: DeskOpKind.BATCH_DISCARD,
        id: uuid(),
        batchId: open.id,
        discardedBy: scanner ?? open.scannedBy,
        discardedAt: new Date().toISOString(),
      });

      await saveOpenBatch(kind, null);

      setOpenBatch(kind, null);
    },
    [openBatches, log, scanner, enqueue, setOpenBatch]
  );

  const value = useMemo<DeskContextValue>(
    () => ({
      ready,
      batch,
      dispatchBatch,
      queueDeskOp: enqueue,
      startBatch,
      removeScan,
      tagScan,
      submitBatch,
      discardBatch,
      couriers,
      batchEntries,
      connection,
      lastSyncedAt,
      pendingCount,
      scanner,
      setScanner,
      log,
      scan,
      syncNow: () => void flush(),
    }),
    [
      ready,
      batch,
      startBatch,
      removeScan,
      tagScan,
      submitBatch,
      discardBatch,
      couriers,
      batchEntries,
      connection,
      lastSyncedAt,
      pendingCount,
      scanner,
      setScanner,
      log,
      scan,
      flush,
    ]
  );

  return <DeskContext.Provider value={value}>{children}</DeskContext.Provider>;
}

export function useDesk(): DeskContextValue {
  const value = useContext(DeskContext);

  if (!value) {
    throw new Error('useDesk must be used inside DeskProvider');
  }

  return value;
}
