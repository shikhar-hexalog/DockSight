// The AI engine's contract. Callers describe the task and the JSON shape they
// want back; a provider (Gemini, the Claude Code CLI, or a mock) does the rest.

import { AiProviderName } from '@hexabuild/shared';

export { AiProviderName };

export interface AiRequest {
  /** What the model is and how it must behave. */
  system: string;
  /** The task, with the data it may use. */
  prompt: string;
  /** JSON Schema the answer must match. */
  schema: Record<string, unknown>;
  /** Images the model may look at (files are written to a temp folder). */
  images?: { name: string; data: Buffer }[];
  /** A short label for logs. */
  purpose: string;
  /** What the mock provider answers: built from the same data, no model involved. */
  mock: () => unknown;
}

export interface AiProvider {
  name: AiProviderName;
  run<T>(request: AiRequest): Promise<T>;
}

export class AiError extends Error {}
