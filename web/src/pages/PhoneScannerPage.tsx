// The phone scanner: opened from the QR code on a laptop screen. The camera
// reads each label; the code goes to that laptop, which handles it like a
// scan from the barcode gun and sends back what it turned out to be.

import { Camera, CircleCheck, CircleX, Loader, Repeat, type LucideIcon } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';

import {
  OutcomeTone,
  REMOTE_OUTCOME,
  REMOTE_TARGET_LABEL,
  RemoteEvent,
  type RemoteResult,
  RemoteRole,
  type RemoteTarget,
} from '@hexabuild/shared';

import { Mono } from '@/components/common/Mono';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CameraState, useCameraScanner } from '@/desk/phone/useCameraScanner';
import { Sound, playSound } from '@/desk/sounds';
import { uuid } from '@/desk/uuid';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

// The camera sees the same label many times a second; one scan per label.
const SAME_CODE_PAUSE_MS = 2500;

const MAX_ENTRIES = 30;

const ScanStatus = {
  SENDING: 'sending',
  SENT: 'sent',
  NO_LAPTOP: 'no-laptop',
  FAILED: 'failed',
  DONE: 'done',
} as const;

type ScanStatus = (typeof ScanStatus)[keyof typeof ScanStatus];

interface Entry {
  id: string;
  code: string;
  status: ScanStatus;
  result: RemoteResult | null;
}

const TONE_SOUND: Record<OutcomeTone, Sound> = {
  [OutcomeTone.GOOD]: Sound.OK,
  [OutcomeTone.REPEAT]: Sound.REPEAT,
  [OutcomeTone.BAD]: Sound.ALERT,
};

const TONE_VIBRATION: Record<OutcomeTone, number[]> = {
  [OutcomeTone.GOOD]: [60],
  [OutcomeTone.REPEAT]: [60, 80, 60],
  [OutcomeTone.BAD]: [300, 120, 300],
};

const TONE_LOOK: Record<OutcomeTone, { icon: LucideIcon; card: string }> = {
  [OutcomeTone.GOOD]: { icon: CircleCheck, card: 'bg-ok text-white' },
  [OutcomeTone.REPEAT]: { icon: Repeat, card: 'bg-warn text-white' },
  [OutcomeTone.BAD]: { icon: CircleX, card: 'bg-overdue text-white' },
};

const STATUS_TEXT: Record<Exclude<ScanStatus, typeof ScanStatus.DONE>, string> = {
  [ScanStatus.SENDING]: 'Sending…',
  [ScanStatus.SENT]: 'Sent, waiting for the laptop…',
  [ScanStatus.NO_LAPTOP]: 'Laptop screen not open. Open Receive or Dispatch there.',
  [ScanStatus.FAILED]: 'Not sent. Check the Wi-Fi and scan again.',
};

function vibrate(pattern: number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not supported (iPhone): the sound is enough.
  }
}

function usePhoneSession(sessionId: string) {
  const [target, setTarget] = useState<RemoteTarget | null>(null);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .joinRemoteSession(sessionId)
      .then(joined => setTarget(joined.target))
      .catch((err: Error) => setError(err.message));
  }, [sessionId]);

  return { target, error };
}

function useResults(sessionId: string, onResult: (result: RemoteResult) => void) {
  const onResultRef = useRef(onResult);

  onResultRef.current = onResult;

  useEffect(() => {
    const events = new EventSource(`/api/remote/sessions/${sessionId}/events?role=${RemoteRole.PHONE}`);

    events.addEventListener(RemoteEvent.RESULT, event => {
      onResultRef.current(JSON.parse((event as MessageEvent<string>).data) as RemoteResult);
    });

    return () => events.close();
  }, [sessionId]);
}

function LatestCard({ entry }: { entry: Entry | undefined }) {
  if (!entry) {
    return <div className="rounded-2xl border border-white/15 p-5 text-center text-sm text-white/60">Point the camera at an AWB barcode</div>;
  }

  if (!entry.result) {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-white/10 p-5">
        <Loader className="size-8 shrink-0 animate-spin" />

        <div className="min-w-0">
          <Mono className="block truncate text-lg">{entry.code}</Mono>

          <p className="text-sm text-white/70">{STATUS_TEXT[entry.status as Exclude<ScanStatus, typeof ScanStatus.DONE>] ?? ''}</p>
        </div>
      </div>
    );
  }

  const outcome = REMOTE_OUTCOME[entry.result.outcome];

  const look = TONE_LOOK[outcome.tone];

  const Icon = look.icon;

  return (
    <div key={entry.id} className={cn('flex items-center gap-3 rounded-2xl p-5 animate-in fade-in-0 zoom-in-95', look.card)}>
      <Icon className="size-10 shrink-0" strokeWidth={2} />

      <div className="min-w-0">
        <p className="text-xl leading-tight font-semibold">{outcome.label}</p>

        <Mono className="block truncate text-base opacity-90">{entry.code}</Mono>
      </div>
    </div>
  );
}

function EntryStatus({ entry }: { entry: Entry }) {
  if (entry.result) {
    const outcome = REMOTE_OUTCOME[entry.result.outcome];

    return <span className={cn('text-xs', outcome.tone === OutcomeTone.BAD ? 'text-red-300' : 'text-white/70')}>{outcome.label}</span>;
  }

  return <span className="text-xs text-white/50">{STATUS_TEXT[entry.status as Exclude<ScanStatus, typeof ScanStatus.DONE>] ?? ''}</span>;
}

function History({ entries }: { entries: Entry[] }) {
  if (entries.length <= 1) {
    return null;
  }

  return (
    <ul className="flex flex-col divide-y divide-white/10">
      {entries.slice(1).map(entry => (
        <li key={entry.id} className="flex items-center justify-between gap-3 py-2">
          <Mono className="truncate text-[13px]">{entry.code}</Mono>

          <EntryStatus entry={entry} />
        </li>
      ))}
    </ul>
  );
}

function CameraOverlay({ state, error, onStart }: { state: CameraState; error: string | null; onStart: () => void }) {
  if (state === CameraState.ON) {
    return <div className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />;
  }

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
      <Button size="lg" onClick={onStart} disabled={state === CameraState.STARTING} className="h-12 bg-white px-6 text-base text-black hover:bg-white/90">
        <Camera className="size-5" />
        {state === CameraState.STARTING ? 'Starting camera…' : 'Start scanning'}
      </Button>

      <CameraError error={error} />
    </div>
  );
}

function CameraError({ error }: { error: string | null }) {
  if (!error) {
    return null;
  }

  return <p className="text-sm text-red-300">{error}</p>;
}

function ManualEntry({ onCode }: { onCode: (code: string) => void }) {
  const [value, setValue] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();

    if (value.trim()) {
      onCode(value.trim());
      setValue('');
    }
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <Input
        value={value}
        onChange={event => setValue(event.target.value)}
        placeholder="Label won't scan? Type the AWB"
        autoComplete="off"
        className="h-11 border-white/20 bg-white/5 font-mono text-white placeholder:font-sans placeholder:text-white/40"
      />

      <Button type="submit" variant="secondary" className="h-11">
        Send
      </Button>
    </form>
  );
}

function SessionError({ message }: { message: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-neutral-950 p-6 text-center text-white">
      <p>{message}</p>
    </div>
  );
}

function Scanner({ sessionId, target }: { sessionId: string; target: RemoteTarget }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const [entries, setEntries] = useState<Entry[]>([]);

  const last = useRef<{ code: string; at: number } | null>(null);

  const update = useCallback((id: string, patch: Partial<Entry>) => {
    setEntries(prev => prev.map(entry => (entry.id === id ? { ...entry, ...patch } : entry)));
  }, []);

  const send = useCallback(
    (raw: string) => {
      const code = raw.trim();

      const now = Date.now();

      if (last.current && last.current.code === code && now - last.current.at < SAME_CODE_PAUSE_MS) {
        return;
      }

      last.current = { code, at: now };

      vibrate([40]);

      const id = uuid();

      setEntries(prev => [{ id, code, status: ScanStatus.SENDING, result: null }, ...prev].slice(0, MAX_ENTRIES));

      api
        .sendRemoteScan(sessionId, { id, code })
        .then(({ delivered }) => update(id, { status: delivered ? ScanStatus.SENT : ScanStatus.NO_LAPTOP }))
        .catch(() => update(id, { status: ScanStatus.FAILED }));
    },
    [sessionId, update]
  );

  useResults(sessionId, result => {
    const tone = REMOTE_OUTCOME[result.outcome].tone;

    playSound(TONE_SOUND[tone]);

    vibrate(TONE_VIBRATION[tone]);

    update(result.scanId, { status: ScanStatus.DONE, result });
  });

  const camera = useCameraScanner(videoRef, send);

  return (
    <div className="flex min-h-dvh flex-col gap-4 bg-neutral-950 p-4 text-white">
      <header className="flex items-baseline justify-between">
        <span className="text-sm font-semibold">Hexalog scanner</span>

        <span className="text-xs text-white/60">{REMOTE_TARGET_LABEL[target]}</span>
      </header>

      <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} muted playsInline className="size-full object-cover" />

        <CameraOverlay state={camera.state} error={camera.error} onStart={() => void camera.start()} />
      </div>

      <LatestCard entry={entries[0]} />

      <ManualEntry onCode={send} />

      <History entries={entries} />
    </div>
  );
}

export function PhoneScannerPage() {
  const { sessionId = '' } = useParams();

  const { target, error } = usePhoneSession(sessionId);

  if (error) {
    return <SessionError message={error} />;
  }

  if (!target) {
    return <SessionError message="Connecting to the laptop…" />;
  }

  return <Scanner sessionId={sessionId} target={target} />;
}
