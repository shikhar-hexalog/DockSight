// OpenAI, Groq and Meta's Model API speak the same chat completions format, so
// one module serves all three: strict structured outputs (json_schema) for the answer
// shape, images and PDFs inline, each preceded by its name so prompts can refer
// to them as ./parcel.jpg and so on.

import type { AiRequest } from '../types.ts';
import { type Engine, type EngineName, Failure, type Outcome, mimeFor, newerFirst, newestPerTier, post, versionOf, waitFromHeaders } from './types.ts';

interface ChatResponse {
  data?: { id: string }[];
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
  error?: { message?: string; code?: string; type?: string };
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

/** Sorts a failed response into what the router should do about it. */
function failureFor(status: number, error: ChatResponse['error']): Failure {
  const code = `${error?.code ?? ''} ${error?.type ?? ''}`;

  if (status === 401 || status === 403 || status === 402 || /insufficient_quota|billing/.test(code)) {
    return Failure.ACCOUNT;
  }

  if (status === 404) {
    return Failure.GONE;
  }

  if ([429, 500, 502, 503, 504].includes(status)) {
    return Failure.BUSY;
  }

  return Failure.REJECTED;
}

function compatibleEngine(options: {
  name: EngineName;
  baseUrl: string;
  keys: string[];
  pickModels: (ids: string[]) => string[];
  pickTextModels?: (ids: string[]) => string[];
  extraBody?: (model: string) => Record<string, unknown>;
}): Engine {
  return {
    name: options.name,

    key: () => options.keys.map(name => process.env[name]?.trim()).find(Boolean),

    async listModels(key) {
      const res = await fetch(`${options.baseUrl}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });

      const json = (await res.json().catch(() => ({}))) as ChatResponse;

      if (!res.ok) {
        throw Object.assign(new Error(`${res.status} ${json.error?.message ?? ''}`.trim()), { failure: failureFor(res.status, json.error) });
      }

      return (json.data ?? []).map(model => model.id);
    },

    pickModels: options.pickModels,

    pickTextModels: options.pickTextModels,

    async call<T>(model: string, key: string, request: AiRequest): Promise<Outcome<T>> {
      const res = await post(
        `${options.baseUrl}/chat/completions`,
        { authorization: `Bearer ${key}` },
        JSON.stringify({
          model,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: contentFor(request) },
          ],
          response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: request.schema } },
          ...(options.extraBody?.(model) ?? {}),
        })
      );

      if (!(res instanceof Response)) {
        return res;
      }

      const json = (await res.json().catch(() => ({}))) as ChatResponse;

      if (!res.ok) {
        return {
          ok: false,
          failure: failureFor(res.status, json.error),
          reason: `${res.status} ${String(json.error?.message ?? '').slice(0, 200)}`,
          retryAfterMs: waitFromHeaders(res.headers) ?? undefined,
        };
      }

      const choice = json.choices?.[0];

      if (choice?.message?.refusal) {
        return { ok: false, failure: Failure.REJECTED, reason: `refused: ${choice.message.refusal.slice(0, 120)}` };
      }

      try {
        return { ok: true, value: JSON.parse(choice?.message?.content ?? '') as T };
      } catch {
        return { ok: false, failure: Failure.GARBLED, reason: `answer not in the requested format${choice?.finish_reason ? ` (${choice.finish_reason})` : ''}` };
      }
    },
  };
}

// GPT models by tier: "gpt-5.5", "gpt-5.4-mini", "gpt-5.4-nano". Dated
// snapshots, "pro" (slow and costly), chat-latest aliases and audio/image
// models don't match, so they are never picked.
const GPT = /^gpt-(\d+(?:\.\d+)?)(?:-(mini|nano))?$/;

// GPT-5 models think before answering; a little is enough for these checks and keeps them quick.
const REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT?.trim() || 'low';

export const openAiEngine = compatibleEngine({
  name: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  keys: ['OPENAI_KEY', 'OPENAI_API_KEY'],
  // The newest full model first (best at small colour and print differences), then the faster mini and nano.
  pickModels: ids =>
    newestPerTier(ids, ['full', 'mini', 'nano'], id => {
      const match = GPT.exec(id);

      return match ? { tier: match[2] ?? 'full', version: versionOf(match[1]) } : null;
    }),
  extraBody: model => (/^gpt-[5-9]/.test(model) ? { reasoning_effort: REASONING_EFFORT } : {}),
});

// Groq (free tier) hosts open models; its model list doesn't say which can see
// images, so only families that do are picked: Qwen ("qwen/qwen3.8-27b") and
// Llama 4 ("meta-llama/llama-4-scout-17b-16e-instruct"). Text-only models such
// as gpt-oss, speech and safety-filter models don't match.
const GROQ_VISION = /^(?:qwen\/qwen(\d+(?:\.\d+)?)-\d+b|meta-llama\/llama-(4)-[a-z]+-[\w-]+)$/;

// Groq's text models ("openai/gpt-oss-120b"): better than the vision model at
// briefs and questions, and each has its own free per-minute limit.
const GROQ_TEXT = /^openai\/gpt-oss-(\d+)b$/;

export const groqEngine = compatibleEngine({
  name: 'groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  keys: ['GROQ_KEY', 'GROQ_API_KEY'],
  pickTextModels: ids =>
    ids
      .map(id => ({ id, size: Number(GROQ_TEXT.exec(id)?.[1] ?? NaN) }))
      .filter(({ size }) => Number.isFinite(size))
      .sort((a, b) => b.size - a.size)
      .map(({ id }) => id),
  pickModels: ids =>
    ids
      .map(id => ({ id, match: GROQ_VISION.exec(id) }))
      .filter(({ match }) => match)
      .sort((a, b) => newerFirst(versionOf(a.match![1] ?? a.match![2]), versionOf(b.match![1] ?? b.match![2])))
      .map(({ id }) => id),
});

// Meta's chat models: "muse-spark-1.3". Image generation, speech and
// segmentation models, and "-contributor" builds, don't match.
const MUSE_SPARK = /^muse-spark-(\d+(?:\.\d+)?)$/;

export const metaEngine = compatibleEngine({
  name: 'meta',
  baseUrl: 'https://api.meta.ai/v1',
  keys: ['META_KEY', 'MODEL_API_KEY'],
  pickModels: ids =>
    ids
      .map(id => ({ id, match: MUSE_SPARK.exec(id) }))
      .filter(({ match }) => match)
      .sort((a, b) => newerFirst(versionOf(a.match![1]), versionOf(b.match![1])))
      .map(({ id }) => id),
});
