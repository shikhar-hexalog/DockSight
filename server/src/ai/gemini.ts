// Runs requests through the Gemini API (generateContent), using GEMINI_API_KEY.
//
// - responseJsonSchema makes Gemini answer in exactly the shape asked for.
// - Images go inline, each preceded by its name, so prompts can refer to
//   them as ./parcel.jpg, ./expected-1.png and so on.
// - The key is sent in a header, never in the URL, so it stays out of logs.
// - A busy or unavailable model hands over to the next one at once, and is
//   skipped for a couple of minutes so later calls don't wait on it again.
//   A bad key or a bad request stops at once: another model would fail the
//   same way.

import { AiError, type AiProvider, AiProviderName, type AiRequest } from './types.ts';

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map(model => model.trim())
    .filter(Boolean);

const PRIMARY_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash';

// Left blank, the defaults are used.
const BACKUP_MODELS = list(process.env.GEMINI_BACKUP_MODELS).length > 0 ? list(process.env.GEMINI_BACKUP_MODELS) : ['gemini-3.1-flash-lite', 'gemini-flash-latest'];

const MODELS = [...new Set([PRIMARY_MODEL, ...BACKUP_MODELS])];

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

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

/** How one attempt went: an answer, or why not and whether another model could help. */
type Attempt<T> = { ok: true; value: T } | { ok: false; reason: string; next: 'busy' | 'skip' | 'stop'; message?: string };

function mimeFor(name: string): string {
  return MIME_FOR[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'image/jpeg';
}

function partsFor(request: AiRequest) {
  const images = (request.images ?? []).flatMap(image => [
    { text: `Image ./${image.name}:` },
    { inlineData: { mimeType: mimeFor(image.name), data: image.data.toString('base64') } },
  ]);

  return [...images, { text: request.prompt }];
}

export function geminiKey(): string | undefined {
  return process.env.GEMINI_API_KEY?.trim() || undefined;
}

async function attempt<T>(model: string, key: string, body: string): Promise<Attempt<T>> {
  let res: Response;

  try {
    res = await fetch(`${API_URL}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body,
      signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = (error as Error).name === 'TimeoutError';

    return { ok: false, reason: timedOut ? 'timed out' : `network error: ${(error as Error).message}`, next: 'busy' };
  }

  const json = (await res.json().catch(() => ({}))) as GeminiResponse;

  if (!res.ok) {
    const reason = `${res.status} ${String(json.error?.message ?? '').slice(0, 200)}`;

    if (BUSY_STATUS.has(res.status)) {
      return { ok: false, reason, next: 'busy' };
    }

    // The model is retired or unknown to this key.
    if (res.status === 404) {
      return { ok: false, reason, next: 'skip' };
    }

    // Google answers a bad key with 400 API_KEY_INVALID, not only 401/403.
    if (res.status === 401 || res.status === 403 || /api key/i.test(json.error?.message ?? '')) {
      return { ok: false, reason, next: 'stop', message: 'The Gemini API key was rejected. Check GEMINI_API_KEY in .env' };
    }

    return { ok: false, reason, next: 'stop', message: 'Gemini could not process this request' };
  }

  if (json.promptFeedback?.blockReason) {
    return { ok: false, reason: `blocked: ${json.promptFeedback.blockReason}`, next: 'stop', message: 'Gemini declined to look at this photo' };
  }

  const candidate = json.candidates?.[0];

  const text = (candidate?.content?.parts ?? [])
    .filter(part => !part.thought)
    .map(part => part.text ?? '')
    .join('');

  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch {
    // A garbled answer is usually a one-off; another model may do better.
    return { ok: false, reason: `answer not in the requested format${candidate?.finishReason ? ` (${candidate.finishReason})` : ''}`, next: 'skip' };
  }
}

export const geminiProvider: AiProvider = {
  name: AiProviderName.GEMINI,

  async run<T>(request: AiRequest): Promise<T> {
    const key = geminiKey();

    if (!key) {
      throw new AiError('GEMINI_API_KEY is not set');
    }

    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: 'user', parts: partsFor(request) }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: request.schema,
      },
    });

    const started = Date.now();

    for (const model of modelsInOrder()) {
      const result = await attempt<T>(model, key, body);

      if (result.ok) {
        busyUntil.delete(model);

        console.log(`[ai] ${request.purpose} answered in ${((Date.now() - started) / 1000).toFixed(1)}s (${model})`);

        return result.value;
      }

      console.warn(`[ai] ${request.purpose}: ${model} failed after ${((Date.now() - started) / 1000).toFixed(1)}s: ${result.reason}`);

      if (result.next === 'stop') {
        throw new AiError(result.message ?? 'Gemini could not answer');
      }

      if (result.next === 'busy') {
        busyUntil.set(model, Date.now() + COOLDOWN_MS);
      }
    }

    throw new AiError('Gemini is busy or unavailable right now, and the backup models failed too');
  },
};
