// AI features: briefs, questions about the data, and reading damaged labels.

import type { ReturnType, Stage } from './constants.ts';

/** Which engine writes AI answers. */
export const AiProviderName = {
  /** `claude -p` on the server machine, using the logged-in Claude subscription. */
  CLAUDE_CLI: 'claude-cli',
  /** Fixed answers built from the data, for development and tests. */
  MOCK: 'mock',
  OFF: 'off',
} as const;

export type AiProviderName = (typeof AiProviderName)[keyof typeof AiProviderName];

export const BriefKind = {
  /** Morning summary of yesterday and what's waiting today. */
  DAILY: 'DAILY',
  /** End-of-shift note for the next shift: what's done, what's left, what to watch. */
  HANDOVER: 'HANDOVER',
} as const;

export type BriefKind = (typeof BriefKind)[keyof typeof BriefKind];

export const BRIEF_KIND_LABEL: Record<BriefKind, string> = {
  [BriefKind.DAILY]: 'Daily brief',
  [BriefKind.HANDOVER]: 'Shift handover',
};

export const BriefTrigger = {
  SCHEDULED: 'scheduled',
  MANUAL: 'manual',
} as const;

export type BriefTrigger = (typeof BriefTrigger)[keyof typeof BriefTrigger];

export const ActionPriority = {
  HIGH: 'high',
  NORMAL: 'normal',
} as const;

export type ActionPriority = (typeof ActionPriority)[keyof typeof ActionPriority];

export interface BriefContent {
  headline: string;
  summary: string;
  sections: { title: string; points: string[] }[];
  actions: { action: string; owner: string | null; priority: ActionPriority }[];
}

export interface Brief {
  id: string;
  kind: BriefKind;
  trigger: BriefTrigger;
  createdAt: string;
  /** Which engine wrote it: claude-cli or mock. */
  provider: string;
  content: BriefContent;
  /** Where it was sent, e.g. "webhook ok", or null if only kept in the app. */
  delivery: string | null;
}

export interface BriefsResponse {
  data: Brief[];
}

export interface AskTable {
  columns: string[];
  rows: string[][];
}

export interface AskAnswer {
  answer: string;
  table: AskTable | null;
  provider: string;
}

export interface AiStatusResponse {
  provider: string;
  dailyAt: string;
  handoverAt: string[];
  webhookConfigured: boolean;
}

export interface LabelMatch {
  returnId: string;
  sourceCode: string;
  type: ReturnType;
  courier: string | null;
  stage: Stage;
}

export interface LabelCandidate {
  code: string;
  /** What the AI thinks the code is, e.g. "AWB" or "order". */
  kind: string;
  confidence: number;
  /** The expected return it belongs to, if any. Unmatched codes are only suggestions. */
  match: LabelMatch | null;
}

export interface LabelReadResponse {
  candidates: LabelCandidate[];
  courier: string | null;
  provider: string;
  note: string | null;
}
