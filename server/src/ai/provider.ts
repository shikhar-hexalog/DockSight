import { execFileSync } from 'node:child_process';

import { claudeCliProvider } from './claudeCli.ts';
import { geminiKey, geminiProvider } from './gemini.ts';
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

/**
 * AI_PROVIDER picks the engine: gemini, claude-cli, mock or off. Unset, it uses
 * Gemini when GEMINI_API_KEY is set, then the Claude CLI when installed, and
 * falls back to mock answers otherwise.
 */
function pickProvider(): AiProvider {
  const requested = process.env.AI_PROVIDER?.trim();

  if (requested === AiProviderName.MOCK) {
    return mockProvider;
  }

  if (requested === AiProviderName.OFF) {
    return offProvider;
  }

  if (requested === AiProviderName.GEMINI) {
    if (!geminiKey()) {
      throw new Error('AI_PROVIDER=gemini but GEMINI_API_KEY is not set');
    }

    return geminiProvider;
  }

  if (requested === AiProviderName.CLAUDE_CLI) {
    return claudeCliProvider;
  }

  if (geminiKey()) {
    return geminiProvider;
  }

  if (claudeInstalled()) {
    return claudeCliProvider;
  }

  return mockProvider;
}

export const ai: AiProvider = pickProvider();
