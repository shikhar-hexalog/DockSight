// AI reporting: the daily brief, the shift handover note, and questions
// about the data. Each answer is written by the AI from the snapshot only.

import { randomUUID } from 'node:crypto';

import {
  ActionPriority,
  type AskAnswer,
  type Brief,
  type BriefContent,
  BriefKind,
  type BriefTrigger,
  type GuardStatus,
} from '@hexabuild/shared';

import { db } from '../db/index.ts';
import { nowIso } from '../lib/time.ts';
import { ai } from './provider.ts';
import { type Snapshot, buildSnapshot } from './snapshot.ts';

const ANALYST_RULES = `You are the operations analyst for Hexalog's returns warehouse in India.
Rules:
- Use only the JSON data given. Never invent numbers, codes, couriers or names.
- Be specific: numbers with units (h, d), courier names, AWBs or return codes when they matter.
- Short plain sentences. No filler, no praise, no emoji.
- Waiting times and TAT are in working hours (see definitions.workingHours); say "working hours" when you quote them.
- If the data can't answer something, say so plainly.`;

const BRIEF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'summary', 'sections', 'actions'],
  properties: {
    headline: { type: 'string', description: 'One sentence: the single most important fact right now.' },
    summary: { type: 'string', description: 'Two or three sentences.' },
    sections: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'points'],
        properties: {
          title: { type: 'string' },
          points: { type: 'array', maxItems: 5, items: { type: 'string' } },
        },
      },
    },
    actions: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['action', 'owner', 'priority'],
        properties: {
          action: { type: 'string', description: 'A concrete next step someone can do today.' },
          owner: { type: ['string', 'null'], description: 'Team or role, e.g. "Receiving", "Dispatch", "Supervisor".' },
          priority: { type: 'string', enum: [ActionPriority.HIGH, ActionPriority.NORMAL] },
        },
      },
    },
  },
};

const ASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'table'],
  properties: {
    answer: { type: 'string', description: 'The direct answer in 1-4 sentences.' },
    table: {
      description: 'Include only when the answer is a list of items; at most 25 rows.',
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['columns', 'rows'],
          properties: {
            columns: { type: 'array', items: { type: 'string' } },
            rows: { type: 'array', maxItems: 25, items: { type: 'array', items: { type: 'string' } } },
          },
        },
      ],
    },
  },
};

const BRIEF_TASK: Record<BriefKind, string> = {
  [BriefKind.DAILY]: `Write the morning brief for the warehouse supervisor.
Cover: what came in and got processed yesterday and today so far, what is pending in Uniware and for how long,
which courier or type is the bottleneck, open set-aside parcels, dispatch holds, and how turnaround is trending
over the last seven days. End with up to five concrete actions for today, most urgent first.`,
  [BriefKind.HANDOVER]: `Write the shift handover note for the incoming shift.
Cover: what this shift received and processed, what is still pending (oldest first, with AWBs for anything over 24h),
set-aside parcels still open, dispatch holds that must be pulled before the next courier pickup, and anything unusual.
End with up to five concrete actions for the next shift, most urgent first.`,
};

// --- Mock answers: same data, fixed wording, so the app works without a model.

function mockBrief(kind: BriefKind, s: Snapshot): BriefContent {
  const oldest = s.pendingReturns[0];

  const worstCourier = s.today.pendingByCourier[0];

  return {
    headline: `${s.today.pendingNow.total} returns are waiting on Uniware; ${s.today.pendingCarriedOverFromBeforeToday} of them arrived before today.`,
    summary: `${s.today.receivedToday.total} received and ${s.today.processedToday.total} processed today. ${s.today.setAsideOpen} parcels are set aside and ${s.today.dispatch.toPullNow} dispatch holds need pulling.`,
    sections: [
      {
        title: 'Pending in Uniware',
        points: [
          oldest ? `Oldest: ${oldest.returnCode} (${oldest.courier}), ${oldest.workingHoursPending} working hours waiting.` : 'Nothing pending.',
          worstCourier ? `${worstCourier.courier} has the most pending: ${worstCourier.count}.` : 'No courier backlog.',
        ],
      },
      {
        title: 'Dispatch',
        points: [`${s.today.dispatch.pulledToday} cancelled parcels pulled out today; ${s.today.dispatch.handedOverAnywayToday} were handed over anyway.`],
      },
    ],
    actions: [
      { action: 'Process the pending returns older than 24h first.', owner: 'Receiving', priority: ActionPriority.HIGH },
      { action: 'Resolve the open set-aside parcels.', owner: 'Supervisor', priority: ActionPriority.NORMAL },
    ].slice(0, kind === BriefKind.DAILY ? 2 : 1),
  };
}

function mockAnswer(question: string, s: Snapshot): Omit<AskAnswer, 'provider'> {
  return {
    answer: `Mock mode: smart answers need GEMINI_API_KEY in .env. "${question}" was not analysed. ${s.today.pendingNow.total} returns are pending right now.`,
    table: {
      columns: ['AWB', 'Return', 'Courier', 'Working hours pending'],
      rows: s.pendingReturns.slice(0, 5).map(r => [r.awb ?? '—', r.returnCode, r.courier ?? '—', String(r.workingHoursPending ?? '—')]),
    },
  };
}

// --- Storage and delivery

type Row = Record<string, unknown>;

function toBrief(row: Row): Brief {
  return {
    id: String(row.id),
    kind: row.kind as BriefKind,
    trigger: row.trigger as BriefTrigger,
    createdAt: String(row.created_at),
    provider: String(row.provider),
    content: JSON.parse(String(row.content)) as BriefContent,
    delivery: row.delivery === null ? null : String(row.delivery),
  };
}

export function listBriefs(limit: number): Brief[] {
  return db.prepare('SELECT * FROM briefs ORDER BY created_at DESC LIMIT ?').all(limit).map(toBrief);
}

export function briefExistsForSlot(kind: BriefKind, slot: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM briefs WHERE kind = ? AND slot = ?').get(kind, slot));
}

/** Plain text for chat tools (Slack, Teams, Google Chat all accept {"text": ...}). */
export function briefAsText(kind: BriefKind, content: BriefContent): string {
  const title = kind === BriefKind.DAILY ? 'Returns · daily brief' : 'Returns · shift handover';

  const sections = content.sections.map(s => `*${s.title}*\n${s.points.map(p => `• ${p}`).join('\n')}`);

  const actions = content.actions.map(a => `${a.priority === ActionPriority.HIGH ? '❗' : '•'} ${a.action}${a.owner ? ` (${a.owner})` : ''}`);

  return [`*${title}*`, content.headline, content.summary, ...sections, `*Next actions*\n${actions.join('\n')}`].join('\n\n');
}

async function deliver(kind: BriefKind, content: BriefContent): Promise<string | null> {
  const url = process.env.BRIEF_WEBHOOK_URL?.trim();

  if (!url) {
    return null;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: briefAsText(kind, content) }),
      signal: AbortSignal.timeout(15_000),
    });

    return res.ok ? 'Sent to webhook' : `Webhook failed: HTTP ${res.status}`;
  } catch (err) {
    return `Webhook failed: ${(err as Error).message}`;
  }
}

export async function generateBrief(kind: BriefKind, trigger: BriefTrigger, guard: GuardStatus, slot: string | null = null): Promise<Brief> {
  const snapshot = buildSnapshot(guard);

  const content = await ai.run<BriefContent>({
    purpose: `${kind.toLowerCase()} brief`,
    system: ANALYST_RULES,
    prompt: `${BRIEF_TASK[kind]}\n\nData (JSON):\n${JSON.stringify(snapshot)}`,
    schema: BRIEF_SCHEMA,
    mock: () => mockBrief(kind, snapshot),
  });

  const delivery = await deliver(kind, content);

  const id = randomUUID();

  db.prepare(
    `INSERT INTO briefs (id, kind, trigger, slot, provider, content, delivery, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, kind, trigger, slot, ai.name, JSON.stringify(content), delivery, nowIso());

  return toBrief(db.prepare('SELECT * FROM briefs WHERE id = ?').get(id)!);
}

export async function askData(question: string, guard: GuardStatus): Promise<AskAnswer> {
  const snapshot = buildSnapshot(guard);

  const answer = await ai.run<Omit<AskAnswer, 'provider'>>({
    purpose: 'question',
    system: ANALYST_RULES,
    prompt: `Answer this question from the warehouse team:\n"${question}"\n\nData (JSON):\n${JSON.stringify(snapshot)}`,
    schema: ASK_SCHEMA,
    mock: () => mockAnswer(question, snapshot),
  });

  return { ...answer, provider: ai.name };
}
