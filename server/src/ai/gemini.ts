// Runs requests through the Gemini API (generateContent), using GEMINI_API_KEY.
//
// - responseJsonSchema makes Gemini answer in exactly the shape asked for.
// - Images go inline, each preceded by its name, so prompts can refer to
//   them as ./parcel.jpg, ./expected-1.png and so on.
// - The key is sent in a header, never in the URL, so it stays out of logs.
// - A busy or unavailable model is retried once, then the backup models are
//   tried in order. A bad key or a bad request stops at once: another model
//   would fail the same way.

import { AiError, type AiProvider, AiProviderName, type AiRequest } from './types.ts';

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map(model => model.trim())
    .filter(Boolean);

const PRIMARY_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-flash-latest';

// Left blank, the defaults are used.
const BACKUP_MODELS = list(process.env.GEMINI_BACKUP_MODELS).length > 0 ? list(process.env.GEMINI_BACKUP_MODELS) : ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];

const MODELS = [...new Set([PRIMARY_MODEL, ...BACKUP_MODELS])];

const ATTEMPT_TIMEOUT_MS = 60_000;

const RETRY_DELAY_MS = 1_500;

// Overloaded, rate-limited or briefly down: worth another try.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const MIME_FOR: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

/** How one attempt went: an answer, or why not and whether another model could help. */
type Attempt<T> = { ok: true; value: T } | { ok: false; reason: string; next: 'retry' | 'skip' | 'stop'; message?: string };

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

    return { ok: false, reason: timedOut ? 'timed out' : `network error: ${(error as Error).message}`, next: 'retry' };
  }

  const json = (await res.json().catch(() => ({}))) as GeminiResponse;

  if (!res.ok) {
    const reason = `${res.status} ${String(json.error?.message ?? '').slice(0, 200)}`;

    if (RETRYABLE_STATUS.has(res.status)) {
      return { ok: false, reason, next: 'retry' };
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

    for (const model of MODELS) {
      for (let tries = 1; tries <= 2; tries++) {
        const result = await attempt<T>(model, key, body);

        if (result.ok) {
          console.log(`[ai] ${request.purpose} answered in ${((Date.now() - started) / 1000).toFixed(1)}s (${model})`);

          return result.value;
        }

        console.warn(`[ai] ${request.purpose}: ${model} failed (try ${tries}): ${result.reason}`);

        if (result.next === 'stop') {
          throw new AiError(result.message ?? 'Gemini could not answer');
        }

        if (result.next === 'skip') {
          break;
        }

        if (tries === 1) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    }

    throw new AiError('Gemini is busy or unavailable right now, and the backup models failed too');
  },
};
