// The handover check: answered instantly from the latest known holds, sent
// to the server in the background, and queued on this computer while the
// network is down. If the server knows of a newer cancellation than the
// screen did, its STOP replaces the screen's answer and the alarm sounds.

import { useCallback, useEffect, useRef, useState } from 'react';

import { type DispatchHold, type HandoverCheck, HandoverResult, HoldStatus, handoverResultFor, normalizeCode } from '@hexabuild/shared';

import { useHolds } from '@/hooks/queries';
import { api } from '@/lib/api';

import { HANDOVER_SOUND, playSound } from './sounds';
import { uuid } from './uuid';

const HOLDS_CACHE_KEY = 'hexabuild.holds';

const QUEUE_KEY = 'hexabuild.handover-queue';

// Today's checks on this desk, so the list survives a reload.
const LOG_KEY = 'hexabuild.handover-log';

const FLUSH_INTERVAL_MS = 10_000;

export interface HandoverEntry {
  check: HandoverCheck;
  result: HandoverResult;
  hold: DispatchHold | null;
  synced: boolean;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the check still shows; it just won't survive a reload.
  }
}

function findHold(holds: DispatchHold[], code: string): DispatchHold | null {
  const normalized = normalizeCode(code);

  return holds.find(hold => [hold.trackingNumber, hold.packageCode, hold.saleOrderCode].some(c => c && normalizeCode(c) === normalized)) ?? null;
}

function startOfToday(): string {
  const start = new Date();

  start.setHours(0, 0, 0, 0);

  return start.toISOString();
}

function readLog(): HandoverEntry[] {
  const since = startOfToday();

  return readJson<HandoverEntry[]>(LOG_KEY, []).filter(entry => entry.check.checkedAt >= since);
}

/**
 * @param batchId the open dispatch handover (courier pickup); checks are only taken inside one.
 * @param queueRemoval sends a "take this check back" to the server, for checks it already has.
 */
export function useHandoverCheck(checkedBy: string | null, batchId: string | null, queueRemoval: (checkId: string) => Promise<void>) {
  const { data } = useHolds();

  // The last holds we heard about, kept for when the network is down.
  const [cachedHolds, setCachedHolds] = useState<DispatchHold[]>(() => readJson(HOLDS_CACHE_KEY, []));

  const [entries, setEntriesState] = useState<HandoverEntry[]>(readLog);

  const setEntries = useCallback((update: (prev: HandoverEntry[]) => HandoverEntry[]) => {
    setEntriesState(prev => {
      const next = update(prev);

      writeJson(LOG_KEY, next);

      return next;
    });
  }, []);

  const [queued, setQueued] = useState<number>(() => readJson<HandoverCheck[]>(QUEUE_KEY, []).length);

  // True after a failed send: answers then come only from the last known holds.
  const [offline, setOffline] = useState(false);

  const flushing = useRef(false);

  useEffect(() => {
    if (data) {
      setCachedHolds(data.data);
      writeJson(HOLDS_CACHE_KEY, data.data);
    }
  }, [data]);

  const flush = useCallback(async () => {
    const queue = readJson<HandoverCheck[]>(QUEUE_KEY, []);

    if (flushing.current || queue.length === 0) {
      return;
    }

    flushing.current = true;

    try {
      const { results } = await api.sendHandoverChecks(queue);

      setOffline(false);

      const byId = new Map(results.map(r => [r.id, r]));

      writeJson(
        QUEUE_KEY,
        readJson<HandoverCheck[]>(QUEUE_KEY, []).filter(check => !byId.has(check.id))
      );

      setEntries(prev =>
        prev.map(entry => {
          const server = byId.get(entry.check.id);

          if (!server) {
            return entry;
          }

          // The server knew about a cancellation the screen didn't: sound the alarm now.
          if (server.result === HandoverResult.STOP && entry.result !== HandoverResult.STOP) {
            playSound(HANDOVER_SOUND[HandoverResult.STOP]);
          }

          return { ...entry, result: server.result, hold: server.hold, synced: true };
        })
      );
    } catch {
      // Offline: the queue stays and is retried.
      setOffline(true);
    } finally {
      flushing.current = false;

      setQueued(readJson<HandoverCheck[]>(QUEUE_KEY, []).length);
    }
  }, []);

  useEffect(() => {
    void flush();

    const timer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);

    window.addEventListener('online', flush);

    return () => {
      clearInterval(timer);
      window.removeEventListener('online', flush);
    };
  }, [flush]);

  const check = useCallback(
    (code: string): string | null => {
      if (!checkedBy || !batchId) {
        return null;
      }

      const handoverCheck: HandoverCheck = { id: uuid(), code: code.trim(), checkedBy, checkedAt: new Date().toISOString(), batchId };

      const hold = findHold(cachedHolds, code);

      const result = handoverResultFor(hold);

      // Pulled the moment it's stopped, so a second scan says "already pulled".
      if (result === HandoverResult.STOP && hold) {
        setCachedHolds(prev => prev.map(h => (h.id === hold.id ? { ...h, status: HoldStatus.PULLED } : h)));
      }

      playSound(HANDOVER_SOUND[result]);

      setEntries(prev => [{ check: handoverCheck, result, hold, synced: false }, ...prev]);

      writeJson(QUEUE_KEY, [...readJson<HandoverCheck[]>(QUEUE_KEY, []), handoverCheck]);

      setQueued(count => count + 1);

      void flush();

      return handoverCheck.id;
    },
    [checkedBy, batchId, cachedHolds, flush, setEntries]
  );

  /** Takes a check back: not sent yet, it's just dropped; sent, the server forgets it too. */
  const remove = useCallback(
    async (checkId: string) => {
      const queue = readJson<HandoverCheck[]>(QUEUE_KEY, []);

      const waiting = queue.some(c => c.id === checkId);

      writeJson(
        QUEUE_KEY,
        queue.filter(c => c.id !== checkId)
      );

      setQueued(readJson<HandoverCheck[]>(QUEUE_KEY, []).length);

      setEntries(prev => prev.filter(entry => entry.check.id !== checkId));

      if (!waiting) {
        await queueRemoval(checkId);
      }
    },
    [queueRemoval, setEntries]
  );

  const batchEntries = batchId ? entries.filter(entry => entry.check.batchId === batchId) : [];

  return { entries, batchEntries, check, remove, queued, offline, holds: cachedHolds };
}
