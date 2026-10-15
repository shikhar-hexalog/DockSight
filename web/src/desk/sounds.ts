// Short tones so the person scanning doesn't have to look at the screen:
// one high beep = fine, two mid beeps = already done, a low buzz = stop / set aside.

import { HandoverResult, OutcomeTone, ScanResult } from '@hexabuild/shared';

export const Sound = {
  OK: 'ok',
  REPEAT: 'repeat',
  ALERT: 'alert',
} as const;

export type Sound = (typeof Sound)[keyof typeof Sound];

interface Tone {
  frequency: number;
  durationMs: number;
}

const TONES: Record<Sound, Tone[]> = {
  [Sound.OK]: [{ frequency: 1046, durationMs: 90 }],
  [Sound.REPEAT]: [
    { frequency: 660, durationMs: 70 },
    { frequency: 660, durationMs: 70 },
  ],
  [Sound.ALERT]: [
    { frequency: 220, durationMs: 380 },
    { frequency: 196, durationMs: 380 },
  ],
};

export const SCAN_SOUND: Record<ScanResult, Sound> = {
  [ScanResult.MATCHED]: Sound.OK,
  [ScanResult.ALREADY_RECEIVED]: Sound.REPEAT,
  [ScanResult.ALREADY_PROCESSED]: Sound.REPEAT,
  [ScanResult.CANCELLED_RETURN]: Sound.ALERT,
  [ScanResult.UNEXPECTED]: Sound.ALERT,
};

export const HANDOVER_SOUND: Record<HandoverResult, Sound> = {
  [HandoverResult.CLEAR]: Sound.OK,
  [HandoverResult.ALREADY_PULLED]: Sound.REPEAT,
  [HandoverResult.STOP]: Sound.ALERT,
  [HandoverResult.INVALID]: Sound.ALERT,
};

const GAP_MS = 60;

let context: AudioContext | null = null;

export function playSound(sound: Sound) {
  try {
    context ??= new AudioContext();

    let at = context.currentTime;

    for (const tone of TONES[sound]) {
      const oscillator = context.createOscillator();

      const gain = context.createGain();

      oscillator.type = 'square';

      oscillator.frequency.value = tone.frequency;

      gain.gain.setValueAtTime(0.08, at);

      oscillator.connect(gain).connect(context.destination);

      oscillator.start(at);

      oscillator.stop(at + tone.durationMs / 1000);

      at += (tone.durationMs + GAP_MS) / 1000;
    }
  } catch {
    // No audio device: the screen still shows the result.
  }
}

/** Any phone-scanner outcome, by how good the news is. */
export const TONE_SOUND: Record<OutcomeTone, Sound> = {
  [OutcomeTone.GOOD]: Sound.OK,
  [OutcomeTone.REPEAT]: Sound.REPEAT,
  [OutcomeTone.BAD]: Sound.ALERT,
};
