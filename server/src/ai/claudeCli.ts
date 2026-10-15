// Runs Claude through the Claude Code CLI in headless mode (`claude -p`),
// using whoever is logged in on this machine. No API key needed.
//
// - The prompt goes in on stdin, so large data snapshots are fine.
// - --json-schema makes Claude answer in exactly the shape asked for.
// - Tools are off, except Read when there's an image to look at; the image
//   is written to a fresh temp folder that is the only thing it can see.
// - Calls run one at a time, to stay well inside subscription limits.

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AiError, type AiProvider, AiProviderName, type AiRequest } from './types.ts';

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude';

const MODEL = process.env.AI_MODEL ?? 'sonnet';

const TIMEOUT_MS = 180_000;

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

interface CliResult {
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
}

let queue: Promise<unknown> = Promise.resolve();

/** Runs calls one after another. */
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);

  queue = next.catch(() => undefined);

  return next;
}

function runCli(args: string[], input: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(CLAUDE_BIN, args, { cwd, timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES }, (error, stdout, stderr) => {
      if (error) {
        reject(new AiError(`claude CLI failed: ${(stderr || error.message).trim().slice(0, 500)}`));
        return;
      }

      resolve(stdout);
    });

    child.stdin?.end(input);
  });
}

function parse<T>(stdout: string): T {
  let envelope: CliResult;

  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new AiError('claude CLI returned something that is not JSON');
  }

  if (envelope.is_error) {
    throw new AiError(`Claude reported an error: ${String(envelope.result ?? '').slice(0, 500)}`);
  }

  if (envelope.structured_output !== undefined) {
    return envelope.structured_output as T;
  }

  // Older CLI versions put the JSON answer in `result` as text.
  try {
    return JSON.parse(String(envelope.result ?? '')) as T;
  } catch {
    throw new AiError('Claude did not answer in the requested format');
  }
}

export const claudeCliProvider: AiProvider = {
  name: AiProviderName.CLAUDE_CLI,

  run<T>(request: AiRequest): Promise<T> {
    return serialized(async () => {
      const folder = await mkdtemp(join(tmpdir(), 'hexabuild-ai-'));

      try {
        for (const image of request.images ?? []) {
          await writeFile(join(folder, image.name), image.data);
        }

        const hasImages = (request.images ?? []).length > 0;

        const args = [
          '-p',
          '--model',
          MODEL,
          '--output-format',
          'json',
          '--json-schema',
          JSON.stringify(request.schema),
          '--system-prompt',
          request.system,
          '--no-session-persistence',
          '--tools',
          hasImages ? 'Read' : '',
          ...(hasImages ? ['--allowedTools', 'Read'] : []),
        ];

        const started = Date.now();

        const stdout = await runCli(args, request.prompt, folder);

        console.log(`[ai] ${request.purpose} answered in ${((Date.now() - started) / 1000).toFixed(1)}s`);

        return parse<T>(stdout);
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    });
  },
};
