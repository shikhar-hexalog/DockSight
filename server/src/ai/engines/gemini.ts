// Gemini (generateContent): responseJsonSchema for the answer shape, images
// and PDFs inline, each preceded by its name so prompts can refer to them as
// ./parcel.jpg and so on. The key goes in a header, never in the URL.

import type { AiRequest } from '../types.ts';
import { type Engine, Failure, type Outcome, mimeFor, newestPerTier, post, versionOf, waitFromHeaders } from './types.ts';

const API_URL = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiResponse {
  models?: { name: string; supportedGenerationMethods?: string[] }[];
  nextPageToken?: string;
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string; details?: { retryDelay?: string }[] };
}

function partsFor(request: AiRequest) {
  const files = (request.images ?? []).flatMap(file => [
    { text: `Image ./${file.name}:` },
    { inlineData: { mimeType: mimeFor(file.name), data: file.data.toString('base64') } },
  ]);

  return [...files, { text: request.prompt }];
}

function failureFor(status: number, error: GeminiResponse['error']): Failure {
  const message = error?.message ?? '';

  // Google answers a bad key with 400 API_KEY_INVALID, not only 401/403.
  if (status === 401 || status === 403 || /api key/i.test(message)) {
    return Failure.ACCOUNT;
  }

  // Quota is per model: a used-up model stays used up for a while, others may still work.
  if (status === 429 && /quota/i.test(message)) {
    return Failure.QUOTA;
  }

  if (status === 404) {
    return Failure.GONE;
  }

  if ([429, 500, 502, 503, 504].includes(status)) {
    return Failure.BUSY;
  }

  return Failure.REJECTED;
}

// Numbered Flash models by tier: "gemini-3.8-flash", "gemini-3.5-flash-lite".
// Previews, image/TTS models, Pro and Gemma don't match.
const FLASH = /^gemini-(\d+(?:\.\d+)?)-flash(-lite)?$/;

// Google's rolling alias for the current Flash-Lite, a last resort if the numbered ones fail.
const LITE_ALIAS = 'gemini-flash-lite-latest';

export const geminiEngine: Engine = {
  name: 'gemini',

  key: () => process.env.GEMINI_API_KEY?.trim() || undefined,

  async listModels(key) {
    const ids: string[] = [];

    let page = '';

    do {
      const res = await fetch(`${API_URL}/models?pageSize=200${page ? `&pageToken=${page}` : ''}`, {
        headers: { 'x-goog-api-key': key },
        signal: AbortSignal.timeout(15_000),
      });

      const json = (await res.json().catch(() => ({}))) as GeminiResponse;

      if (!res.ok) {
        throw Object.assign(new Error(`${res.status} ${json.error?.message ?? ''}`.trim()), { failure: failureFor(res.status, json.error) });
      }

      for (const model of json.models ?? []) {
        if (model.supportedGenerationMethods?.includes('generateContent')) {
          ids.push(model.name.replace(/^models\//, ''));
        }
      }

      page = json.nextPageToken ?? '';
    } while (page);

    return ids;
  },

  // The newest Flash first (best quality), then the newest Flash-Lite, which
  // has its own quota and keeps working when Flash's is used up.
  pickModels(ids) {
    const numbered = newestPerTier(ids, ['flash', 'lite'], id => {
      const match = FLASH.exec(id);

      return match ? { tier: match[2] ? 'lite' : 'flash', version: versionOf(match[1]) } : null;
    });

    return ids.includes(LITE_ALIAS) ? [...numbered, LITE_ALIAS] : numbered;
  },

  async call<T>(model: string, key: string, request: AiRequest): Promise<Outcome<T>> {
    const res = await post(
      `${API_URL}/models/${model}:generateContent`,
      { 'x-goog-api-key': key },
      JSON.stringify({
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: 'user', parts: partsFor(request) }],
        generationConfig: { responseMimeType: 'application/json', responseJsonSchema: request.schema },
      })
    );

    if (!(res instanceof Response)) {
      return res;
    }

    const json = (await res.json().catch(() => ({}))) as GeminiResponse;

    if (!res.ok) {
      // Google puts its wait in the error body ("retryDelay": "16s") rather than a header.
      const delay = json.error?.details?.find(detail => detail.retryDelay)?.retryDelay;

      const retryAfterMs = delay ? Number.parseFloat(delay) * 1000 : (waitFromHeaders(res.headers) ?? undefined);

      return { ok: false, failure: failureFor(res.status, json.error), reason: `${res.status} ${String(json.error?.message ?? '').slice(0, 200)}`, retryAfterMs };
    }

    if (json.promptFeedback?.blockReason) {
      return { ok: false, failure: Failure.REJECTED, reason: `blocked: ${json.promptFeedback.blockReason}` };
    }

    const candidate = json.candidates?.[0];

    const text = (candidate?.content?.parts ?? [])
      .filter(part => !part.thought)
      .map(part => part.text ?? '')
      .join('');

    try {
      return { ok: true, value: JSON.parse(text) as T };
    } catch {
      return { ok: false, failure: Failure.GARBLED, reason: `answer not in the requested format${candidate?.finishReason ? ` (${candidate.finishReason})` : ''}` };
    }
  },
};
