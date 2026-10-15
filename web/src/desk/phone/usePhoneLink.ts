// The laptop side of the phone scanner: opens a session, listens for codes
// the phone reads, and sends back what each one turned out to be.
// The session is kept for this tab, so a reload doesn't need a new pairing.

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type HandoverResult,
  RemoteEvent,
  RemoteRole,
  type RemoteScan,
  type RemoteSession,
  type RemoteTarget,
  type ScanResult,
} from '@hexabuild/shared';

import { api } from '@/lib/api';

const storageKey = (target: RemoteTarget) => `hexabuild.phone-session.${target}`;

function readSession(target: RemoteTarget): RemoteSession | null {
  try {
    const raw = sessionStorage.getItem(storageKey(target));

    return raw ? (JSON.parse(raw) as RemoteSession) : null;
  } catch {
    return null;
  }
}

function writeSession(target: RemoteTarget, session: RemoteSession | null) {
  try {
    if (session) {
      sessionStorage.setItem(storageKey(target), JSON.stringify(session));
    } else {
      sessionStorage.removeItem(storageKey(target));
    }
  } catch {
    // Blocked storage: pairing lasts until reload.
  }
}

export type PhoneLink = ReturnType<typeof usePhoneLink>;

export function usePhoneLink(target: RemoteTarget, onScan: (scan: RemoteScan) => void) {
  const [session, setSession] = useState<RemoteSession | null>(() => readSession(target));

  const [phoneJoined, setPhoneJoined] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // Latest handler without reconnecting the stream on every render.
  const onScanRef = useRef(onScan);

  onScanRef.current = onScan;

  useEffect(() => {
    if (!session) {
      return;
    }

    const events = new EventSource(`/api/remote/sessions/${session.id}/events?role=${RemoteRole.LAPTOP}`);

    events.addEventListener(RemoteEvent.PHONE_JOINED, () => setPhoneJoined(true));

    events.addEventListener(RemoteEvent.SCAN, event => {
      setPhoneJoined(true);

      onScanRef.current(JSON.parse((event as MessageEvent<string>).data) as RemoteScan);
    });

    events.onerror = () => {
      // The server forgot the session (restart): start over on next open.
      if (events.readyState === EventSource.CLOSED) {
        writeSession(target, null);
        setSession(null);
        setPhoneJoined(false);
      }
    };

    return () => events.close();
  }, [session, target]);

  const start = useCallback(async () => {
    if (session) {
      return;
    }

    try {
      setError(null);

      const created = await api.createRemoteSession(target);

      writeSession(target, created);

      setSession(created);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [session, target]);

  const disconnect = useCallback(() => {
    writeSession(target, null);

    setSession(null);

    setPhoneJoined(false);
  }, [target]);

  const report = useCallback(
    (scanId: string, code: string, outcome: ScanResult | HandoverResult) => {
      if (session) {
        void api.sendRemoteResult(session.id, { scanId, code, outcome }).catch(() => undefined);
      }
    },
    [session]
  );

  return { session, phoneJoined, error, start, disconnect, report };
}
