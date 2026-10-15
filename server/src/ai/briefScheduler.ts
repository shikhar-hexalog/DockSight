// Writes the daily brief and shift handover notes at set times, once each.
//
// BRIEF_DAILY_AT     time of the morning brief, e.g. "09:00"
// BRIEF_HANDOVER_AT  shift change times, e.g. "14:00,22:00"
//
// A slot missed while the server was off is still written if it's less than
// a few hours late; older ones are skipped rather than sent stale.

import { BriefKind, BriefTrigger, type GuardStatus } from '@hexabuild/shared';

import { HOUR_MS, MINUTE_MS } from '../lib/time.ts';
import { briefExistsForSlot, generateBrief } from './reporting.ts';

const CHECK_EVERY_MS = MINUTE_MS;

const LATEST_CATCH_UP_MS = 3 * HOUR_MS;

const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function parseTimes(value: string | undefined, fallback: string): string[] {
  return (value?.trim() || fallback)
    .split(',')
    .map(t => t.trim())
    .filter(t => TIME_PATTERN.test(t));
}

export const briefSchedule = {
  dailyAt: parseTimes(process.env.BRIEF_DAILY_AT, '09:00'),
  handoverAt: parseTimes(process.env.BRIEF_HANDOVER_AT, '14:00,22:00'),
};

const pad = (n: number) => String(n).padStart(2, '0');

function slotFor(time: string, now: Date): { key: string; at: number } {
  const [hours, minutes] = time.split(':').map(Number);

  const at = new Date(now);

  at.setHours(hours, minutes, 0, 0);

  return { key: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(hours)}:${pad(minutes)}`, at: at.getTime() };
}

export class BriefScheduler {
  private timer: NodeJS.Timeout | null = null;

  private busy = false;

  constructor(private readonly guardStatus: () => GuardStatus) {}

  start() {
    this.timer = setInterval(() => void this.tick(), CHECK_EVERY_MS);

    void this.tick();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private dueSlots(now: Date): { kind: BriefKind; key: string }[] {
    const slots = [
      ...briefSchedule.dailyAt.map(time => ({ kind: BriefKind.DAILY, ...slotFor(time, now) })),
      ...briefSchedule.handoverAt.map(time => ({ kind: BriefKind.HANDOVER, ...slotFor(time, now) })),
    ];

    return slots.filter(slot => slot.at <= now.getTime() && now.getTime() - slot.at < LATEST_CATCH_UP_MS);
  }

  private async tick() {
    if (this.busy) {
      return;
    }

    this.busy = true;

    try {
      for (const slot of this.dueSlots(new Date())) {
        if (briefExistsForSlot(slot.kind, slot.key)) {
          continue;
        }

        try {
          await generateBrief(slot.kind, BriefTrigger.SCHEDULED, this.guardStatus(), slot.key);

          console.log(`[briefs] wrote ${slot.kind.toLowerCase()} for ${slot.key}`);
        } catch (err) {
          console.error(`[briefs] ${slot.kind.toLowerCase()} for ${slot.key} failed: ${(err as Error).message}`);
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
