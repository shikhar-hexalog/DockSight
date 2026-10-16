// Runs requests through the OpenAI API (chat completions), using OPENAI_KEY
// (or OPENAI_API_KEY).
//
// - Structured outputs (json_schema, strict) make the model answer in exactly
//   the shape asked for.
// - Images and PDFs go inline, each preceded by its name, so prompts can refer
//   to them as ./parcel.jpg, ./expected-1.png and so on.
// - A busy or unavailable model hands over to the next one at once, and is
//   skipped for a couple of minutes so later calls don't wait on it again.
//   A bad key or a bad request stops at once: another model would fail the
//   same way.

import { AiError, type AiProvider, AiProviderName, type AiRequest } from './types.ts';

const API_URL = 'https://api.openai.com/v1/chat/completions';

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map(model => model.trim())
    .filter(Boolean);

const PRIMARY_MODEL = process.env.OPENAI_MODEL?.trim() || 'gpt-5.5';

// Left blank, the defaults are used.
const BACKUP_MODELS = list(process.env.OPENAI_BACKUP_MODELS).length > 0 ? list(process.env.OPENAI_BACKUP_MODELS) : ['gpt-5.4-mini', 'gpt-4.1-mini'];

const MODELS = [...new Set([PRIMARY_MODEL, ...BACKUP_MODELS])];

// GPT-5 models think before answering; a little is enough for these checks and keeps them quick.
const REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT?.trim() || 'low';

const ATTEMPT_TIMEOUT_MS = 30_000;

// How long a busy model is passed over before it is tried first again.
const COOLDOWN_MS = 2 * 60_000;

// Overloaded, rate-limited or briefly down: try another model, and this one later.
const BUSY_STATUS = new Set([429, 500, 502, 503, 504]);

/** Model -> when it may be tried first again. */
const busyUntil = new Map<string, number>();

/** Models in order, with any that were just busy moved to the end (still tried as a last resort). */
function modelsInOrder(): string[] {
  const now = Date.now();

  const ready = MODELS.filter(model => (busyUntil.get(model) ?? 0) <= now);

  return [...ready, ...MODELS.filter(model => !ready.includes(model))];
}

const MIME_FOR: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

interface OpenAiResponse {
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
  error?: { message?: string; code?: string };
}

/** How one attempt went: an answer, or why not and whether another model could help. */
type Attempt<T> = { ok: true; value: T } | { ok: false; reason: string; next: 'busy' | 'skip' | 'stop'; message?: string };

function mimeFor(name: string): string {
  return MIME_FOR[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'image/jpeg';
}

function contentFor(request: AiRequest) {
  const files = (request.images ?? []).flatMap(file => {
    const mime = mimeFor(file.name);

    const url = `data:${mime};base64,${file.data.toString('base64')}`;

    const part = mime === 'application/pdf' ? { type: 'file', file: { filename: file.name, file_data: url } } : { type: 'image_url', image_url: { url } };

    return [{ type: 'text', text: `Image ./${file.name}:` }, part];
  });

  return [...files, { type: 'text', text: request.prompt }];
}

export function openAiKey(): string | undefined {
  return process.env.OPENAI_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || undefined;
}

function bodyFor(model: string, request: AiRequest): string {
  return JSON.stringify({
    model,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: contentFor(request) },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: request.schema } },
    // Only the GPT-5 family takes a reasoning effort.
    ...(model.startsWith('gpt-5') ? { reasoning_effort: REASONING_EFFORT } : {}),
  });
}

async function attempt<T>(model: string, key: string, request: AiRequest): Promise<Attempt<T>> {
  let res: Response;

  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: bodyFor(model, request),
      signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = (error as Error).name === 'TimeoutError';

    return { ok: false, reason: timedOut ? 'timed out' : `network error: ${(error as Error).message}`, next: 'busy' };
  }

  const json = (await res.json().catch(() => ({}))) as OpenAiResponse;

  if (!res.ok) {
    const reason = `${res.status} ${String(json.error?.message ?? '').slice(0, 200)}`;

    if (BUSY_STATUS.has(res.status)) {
      // An exhausted quota won't come back in two minutes: say so plainly.
      if (json.error?.code === 'insufficient_quota') {
        return { ok: false, reason, next: 'stop', message: 'The OpenAI account is out of credit. Check billing for OPENAI_KEY' };
      }

      return { ok: false, reason, next: 'busy' };
    }

    // The model is retired or not available to this key.
    if (res.status === 404) {
      return { ok: false, reason, next: 'skip' };
    }

    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason, next: 'stop', message: 'The OpenAI API key was rejected. Check OPENAI_KEY in .env' };
    }

    return { ok: false, reason, next: 'stop', message: 'OpenAI could not process this request' };
  }

  const choice = json.choices?.[0];

  if (choice?.message?.refusal) {
    return { ok: false, reason: `refused: ${choice.message.refusal.slice(0, 120)}`, next: 'stop', message: 'OpenAI declined to look at this photo' };
  }

  try {
    return { ok: true, value: JSON.parse(choice?.message?.content ?? '') as T };
  } catch {
    // A cut-off or garbled answer is usually a one-off; another model may do better.
    return { ok: false, reason: `answer not in the requested format${choice?.finish_reason ? ` (${choice.finish_reason})` : ''}`, next: 'skip' };
  }
}

export const openAiProvider: AiProvider = {
  name: AiProviderName.OPENAI,

  async run<T>(request: AiRequest): Promise<T> {
    const key = openAiKey();

    if (!key) {
      throw new AiError('OPENAI_KEY is not set');
    }

    const started = Date.now();

    for (const model of modelsInOrder()) {
      const result = await attempt<T>(model, key, request);

      if (result.ok) {
        busyUntil.delete(model);

        console.log(`[ai] ${request.purpose} answered in ${((Date.now() - started) / 1000).toFixed(1)}s (${model})`);

        return result.value;
      }

      console.warn(`[ai] ${request.purpose}: ${model} failed after ${((Date.now() - started) / 1000).toFixed(1)}s: ${result.reason}`);

      if (result.next === 'stop') {
        throw new AiError(result.message ?? 'OpenAI could not answer');
      }

      if (result.next === 'busy') {
        busyUntil.set(model, Date.now() + COOLDOWN_MS);
      }
    }

    throw new AiError('OpenAI is busy or unavailable right now, and the backup models failed too');
  },
};
