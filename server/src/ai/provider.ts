import { execFileSync } from 'node:child_process';

import { claudeCliProvider } from './claudeCli.ts';
import { availableEngines, routerProvider } from './router.ts';
import { AiError, type AiProvider, AiProviderName, type AiRequest } from './types.ts';

const mockProvider: AiProvider = {
  name: AiProviderName.MOCK,

  async run<T>(request: AiRequest): Promise<T> {
    return request.mock() as T;
  },
};

const offProvider: AiProvider = {
  name: AiProviderName.OFF,

  async run<T>(): Promise<T> {
    throw new AiError('Smart features are turned off (AI_PROVIDER=off)');
  },
};

function claudeInstalled(): boolean {
  try {
    execFileSync(process.env.CLAUDE_BIN ?? 'claude', ['--version'], { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

const KEY_FOR = { groq: 'GROQ_KEY', gemini: 'GEMINI_API_KEY', meta: 'META_KEY', openai: 'OPENAI_KEY' } as const;

/**
 * AI_PROVIDER picks the engine. Unset (or auto), every engine with a key in
 * .env is used in turn (Groq, Gemini, Meta, OpenAI; see router.ts), then the
 * Claude CLI when installed, then mock answers. groq | gemini | meta | openai uses only that
 * one; claude-cli, mock and off do what they say.
 */
function pickProvider(): AiProvider {
  const requested = process.env.AI_PROVIDER?.trim() || AiProviderName.AUTO;

  if (requested === AiProviderName.MOCK) {
    return mockProvider;
  }

  if (requested === AiProviderName.OFF) {
    return offProvider;
  }

  if (requested === AiProviderName.CLAUDE_CLI) {
    return claudeCliProvider;
  }

  if (requested === AiProviderName.GROQ || requested === AiProviderName.GEMINI || requested === AiProviderName.META || requested === AiProviderName.OPENAI) {
    if (availableEngines(requested).length === 0) {
      throw new Error(`AI_PROVIDER=${requested} but ${KEY_FOR[requested]} is not set`);
    }

    return routerProvider(requested);
  }

  if (availableEngines().length > 0) {
    return routerProvider();
  }

  if (claudeInstalled()) {
    return claudeCliProvider;
  }

  return mockProvider;
}

export const ai: AiProvider = pickProvider();
