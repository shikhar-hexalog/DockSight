import { execFileSync } from 'node:child_process';

import { claudeCliProvider } from './claudeCli.ts';
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
    throw new AiError('AI is turned off (AI_PROVIDER=off)');
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
 * AI_PROVIDER picks the engine: claude-cli, mock or off. Unset, it uses the
 * Claude CLI when installed and falls back to mock answers otherwise.
 */
function pickProvider(): AiProvider {
  const requested = process.env.AI_PROVIDER?.trim();

  if (requested === AiProviderName.MOCK) {
    return mockProvider;
  }

  if (requested === AiProviderName.OFF) {
    return offProvider;
  }

  if (requested === AiProviderName.CLAUDE_CLI || claudeInstalled()) {
    return claudeCliProvider;
  }

  return mockProvider;
}

export const ai: AiProvider = pickProvider();
