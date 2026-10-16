// Picks a working AI model for each request, across every engine with a key
// in .env (Groq, Gemini, Meta, OpenAI), with no model names hard-coded. An engine
// without a key is simply left out, so each deployment uses whatever keys it has.
//
// - Models: each engine's model list is fetched from its API and the newest
//   suitable ones are picked (see each engine's pickModels). The list is
//   refreshed every few hours, so new models are used and retired ones
//   dropped on their own. <ENGINE>_MODELS in .env pins a list instead.
// - Health: a busy model is skipped for a couple of minutes, a model whose
//   quota is used up for an hour, a retired one for hours; a bad key or
//   missing billing sidelines the whole engine for an hour.
// - Retry: healthy models engine after engine, moving to the next engine after
//   two slow failures, within one overall time limit. A request fails only
//   when every engine has.

import { groqEngine, metaEngine, openAiEngine } from './engines/openaiCompatible.ts';
import { geminiEngine } from './engines/gemini.ts';
import { type Engine, type EngineName, Failure } from './engines/types.ts';
import { AiError, type AiProvider, AiProviderName, type AiRequest } from './types.ts';

const ENGINES: Record<EngineName, Engine> = { groq: groqEngine, gemini: geminiEngine, meta: metaEngine, openai: openAiEngine };

// Groq first: free, fast (1-2s a check) and rarely busy. Gemini's free lite models next.
const DEFAULT_ORDER: EngineName[] = ['groq', 'gemini', 'meta', 'openai'];

const MINUTE = 60_000;

// Busy spells are short (a per-minute limit, a demand spike), so a busy model
// rests briefly; when the engine says how long to wait, that is used instead.
const COOLDOWN_MS: Partial<Record<Failure, number>> = {
  [Failure.BUSY]: 30_000,
  [Failure.QUOTA]: 60 * MINUTE,
  [Failure.GONE]: 6 * 60 * MINUTE,
};

const ENGINE_COOLDOWN_MS = 60 * MINUTE;

// A busy model that says it frees up within this long is waited for and asked
// again; any longer, and the next engine (a few seconds) is quicker.
const SHORT_WAIT_MS = 8_000;

// A model that hung until the timeout tends to hang again: it rests longer.
const HUNG_REST_MS = 3 * MINUTE;

// Slow failures (busy, timed out) allowed per engine before moving on. Fast
// ones (quota used up, retired, rejected) cost a second and don't count.
const SLOW_FAILURES_PER_ENGINE = 2;

// Long enough for a slow model plus a couple of hand-overs; short enough that the desk isn't left waiting.
const REQUEST_DEADLINE_MS = 75_000;

const CATALOG_REFRESH_MS = 6 * 60 * MINUTE;

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

/** <ENGINE>_MODELS in .env: exactly these models, nothing discovered. */
function pinnedModels(engine: EngineName): string[] {
  return list(process.env[`${engine.toUpperCase()}_MODELS`]?.replace(/"/g, ''));
}

/** The older <ENGINE>_MODEL and _BACKUP_MODELS: tried first, with the discovered models after them. */
function preferredModels(engine: EngineName): string[] {
  const prefix = engine.toUpperCase();

  return [...new Set([...list(process.env[`${prefix}_MODEL`]), ...list(process.env[`${prefix}_BACKUP_MODELS`])].map(model => model.replace(/"/g, '')))];
}

interface Catalog {
  models: string[];
  /** For text-only requests, when the engine has better models for text. */
  textModels: string[];
  fetchedAt: number;
  pinned: boolean;
}

const catalogs = new Map<EngineName, Catalog>();

/** "engine:model" or "engine" -> until when it is skipped, and why. */
const sidelined = new Map<string, { until: number; why: string; failure?: Failure }>();

function isSidelined(id: string): boolean {
  const entry = sidelined.get(id);

  return entry !== undefined && entry.until > Date.now();
}

function sideline(id: string, ms: number, why: string, failure?: Failure) {
  sidelined.set(id, { until: Date.now() + ms, why, failure });
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const refreshing = new Map<EngineName, Promise<void>>();

async function refreshCatalog(engine: Engine, key: string): Promise<void> {
  const pinned = pinnedModels(engine.name);

  if (pinned.length > 0) {
    catalogs.set(engine.name, { models: pinned, textModels: [], fetchedAt: Date.now(), pinned: true });
    return;
  }

  const preferred = preferredModels(engine.name);

  try {
    const ids = await engine.listModels(key);

    const models = [...new Set([...preferred, ...engine.pickModels(ids)])];

    const textModels = engine.pickTextModels?.(ids) ?? [];

    catalogs.set(engine.name, { models, textModels, fetchedAt: Date.now(), pinned: false });

    console.log(`[ai] ${engine.name} models: ${models.join(', ') || 'none suitable'}${textModels.length ? ` (text: ${textModels.join(', ')})` : ''}`);
  } catch (error) {
    const failure = (error as { failure?: Failure }).failure;

    if (failure === Failure.ACCOUNT) {
      sideline(engine.name, ENGINE_COOLDOWN_MS, (error as Error).message);
    }

    // The preferred models still work without the list.
    if (preferred.length > 0 && !catalogs.has(engine.name)) {
      catalogs.set(engine.name, { models: preferred, textModels: [], fetchedAt: Date.now() - CATALOG_REFRESH_MS + 5 * MINUTE, pinned: false });
    }

    console.warn(`[ai] ${engine.name}: couldn't list models: ${(error as Error).message}`);
  }
}

/**
 * The engine's models for this request, refreshing the list first when it's
 * missing; refreshed in the background when old. Text-only requests use the
 * engine's text models first, then its vision models.
 */
async function modelsOf(engine: Engine, key: string, textOnly = false): Promise<string[]> {
  const catalog = catalogs.get(engine.name);

  const stale = !catalog || Date.now() - catalog.fetchedAt > CATALOG_REFRESH_MS;

  if (stale && !refreshing.has(engine.name)) {
    refreshing.set(
      engine.name,
      refreshCatalog(engine, key).finally(() => refreshing.delete(engine.name))
    );
  }

  if (!catalog) {
    await refreshing.get(engine.name);
  }

  const current = catalogs.get(engine.name);

  if (!current) {
    return [];
  }

  return textOnly ? [...new Set([...current.textModels, ...current.models])] : current.models;
}

/** Engines with a key, in AI_ENGINES order (default groq, gemini, meta, openai). */
export function availableEngines(only?: EngineName): Engine[] {
  const order = only ? [only] : (list(process.env.AI_ENGINES).filter(name => name in ENGINES) as EngineName[]);

  return (order.length > 0 ? order : DEFAULT_ORDER).map(name => ENGINES[name]).filter(engine => engine.key());
}

async function run<T>(engines: Engine[], request: AiRequest): Promise<T> {
  const started = Date.now();

  const timeLeft = () => REQUEST_DEADLINE_MS - (Date.now() - started);

  const problems: string[] = [];

  let tried = 0;

  /** One model, asked again once if it says it frees up within a few seconds. */
  async function ask(engine: Engine, key: string, model: string): Promise<{ ok: true; value: T } | { ok: false; failure: Failure }> {
    for (let round = 1; round <= 2; round++) {
      tried++;

      const outcome = await engine.call<T>(model, key, request);

      const elapsed = ((Date.now() - started) / 1000).toFixed(1);

      if (outcome.ok) {
        sidelined.delete(`${engine.name}:${model}`);

        console.log(`[ai] ${request.purpose} answered in ${elapsed}s (${engine.name} ${model})`);

        return outcome;
      }

      console.warn(`[ai] ${request.purpose}: ${engine.name} ${model} failed after ${elapsed}s: ${outcome.failure}: ${outcome.reason}`);

      const wait = outcome.retryAfterMs;

      if (round === 1 && outcome.failure === Failure.BUSY && wait !== undefined && wait <= SHORT_WAIT_MS && wait < timeLeft() - 5_000) {
        console.log(`[ai] ${request.purpose}: ${engine.name} ${model} frees up in ${(wait / 1000).toFixed(1)}s, waiting`);

        await pause(wait + 250);
        continue;
      }

      if (outcome.failure === Failure.ACCOUNT) {
        sideline(engine.name, ENGINE_COOLDOWN_MS, outcome.reason, outcome.failure);
      } else {
        const hung = outcome.reason === 'timed out';

        const rest = hung ? HUNG_REST_MS : outcome.failure === Failure.BUSY && wait !== undefined ? Math.max(wait, 5_000) : COOLDOWN_MS[outcome.failure];

        if (rest) {
          sideline(`${engine.name}:${model}`, rest, outcome.reason, outcome.failure);
        }
      }

      // A retired model means the list is out of date: fetch it again next time.
      if (outcome.failure === Failure.GONE && !catalogs.get(engine.name)?.pinned) {
        catalogs.delete(engine.name);
      }

      problems.push(`${engine.name} ${model}: ${outcome.failure}`);

      return { ok: false, failure: outcome.failure };
    }

    return { ok: false, failure: Failure.BUSY };
  }

  const ready: { engine: Engine; key: string; models: string[] }[] = [];

  for (const engine of engines) {
    const key = engine.key()!;

    const models = isSidelined(engine.name) ? [] : await modelsOf(engine, key, (request.images ?? []).length === 0);

    // Listing the models can itself reveal a bad key or missing billing.
    if (isSidelined(engine.name)) {
      problems.push(`${engine.name}: ${sidelined.get(engine.name)!.why}`);
      continue;
    }

    if (models.length === 0) {
      problems.push(`${engine.name}: no usable models`);
      continue;
    }

    ready.push({ engine, key, models });

    let slowFailures = 0;

    for (const model of models.filter(id => !isSidelined(`${engine.name}:${id}`))) {
      if (timeLeft() <= 0 || slowFailures >= SLOW_FAILURES_PER_ENGINE) {
        break;
      }

      const result = await ask(engine, key, model);

      if (result.ok) {
        return result.value;
      }

      if (result.failure === Failure.ACCOUNT) {
        break;
      }

      if (result.failure === Failure.BUSY) {
        slowFailures++;
      }
    }
  }

  // Last resort: models that were only busy (not out of quota or retired) may
  // have freed up by now. The one due back soonest is tried first.
  const resting = ready
    .filter(({ engine }) => !isSidelined(engine.name))
    .flatMap(({ engine, key, models }) =>
      models
        .map(model => ({ engine, key, model, entry: sidelined.get(`${engine.name}:${model}`) }))
        .filter(({ entry }) => entry?.failure === Failure.BUSY)
    )
    .sort((a, b) => a.entry!.until - b.entry!.until);

  for (const { engine, key, model, entry } of resting.slice(0, 2)) {
    const wait = entry!.until - Date.now();

    if (wait > timeLeft() - 5_000) {
      break;
    }

    if (wait > 0) {
      await pause(Math.min(wait, SHORT_WAIT_MS));
    }

    const result = await ask(engine, key, model);

    if (result.ok) {
      return result.value;
    }
  }

  console.warn(`[ai] ${request.purpose}: no model answered (${tried} tried): ${problems.join('; ')}`);

  throw new AiError(tried === 0 && problems.length === 0 ? 'No AI engine has a key in .env' : 'The smart check is unavailable right now: every AI model is busy or failing. Try again in a minute.');
}

/** One engine (AI_PROVIDER=openai|gemini|meta), or all of them in order (the default). */
export function routerProvider(only?: EngineName): AiProvider {
  const names = { groq: AiProviderName.GROQ, gemini: AiProviderName.GEMINI, meta: AiProviderName.META, openai: AiProviderName.OPENAI } as const;

  const name = only ? names[only] : AiProviderName.AUTO;

  return {
    name,
    run: <T>(request: AiRequest) => run<T>(availableEngines(only), request),
  };
}

/** Loads every engine's model list at startup, so the first check doesn't wait for it. */
export function warmUpModels() {
  for (const engine of availableEngines()) {
    void modelsOf(engine, engine.key()!);
  }
}
