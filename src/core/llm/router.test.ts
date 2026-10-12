import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from '@ai-sdk/provider';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { parseEnv, resetEnvCache } from '../../config/env.ts';
import type { CompletionRequest } from './router.ts';
import { createRouter, FAST_MODEL, llmRouter, resetLlmRouter, STRONG_MODEL } from './router.ts';

const gate = vi.hoisted(() => ({
  googleParams: [] as { apiKey?: string }[],
  anthropicParams: [] as { apiKey?: string }[],
  fastIds: [] as string[],
  strongIds: [] as string[],
  fast: undefined as MockLanguageModelV4 | undefined,
  strong: undefined as MockLanguageModelV4 | undefined,
}));

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: (options: { apiKey?: string }) => {
    gate.googleParams.push(options);

    return (modelId: string) => {
      gate.fastIds.push(modelId);

      if (gate.fast === undefined) {
        throw new Error('fast model mock was not installed');
      }

      return gate.fast;
    };
  },
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: (options: { apiKey?: string }) => {
    gate.anthropicParams.push(options);

    return (modelId: string) => {
      gate.strongIds.push(modelId);

      if (gate.strong === undefined) {
        throw new Error('strong model mock was not installed');
      }

      return gate.strong;
    };
  },
}));

const usage: LanguageModelV4GenerateResult['usage'] = {
  inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 2, text: 2, reasoning: undefined },
};

function generated(
  text: string,
  extra: LanguageModelV4GenerateResult['content'] = [],
): LanguageModelV4GenerateResult {
  return {
    content: [...extra, { type: 'text', text }],
    finishReason: { unified: 'stop', raw: undefined },
    usage,
    warnings: [],
  };
}

function install(text = 'save'): { fast: MockLanguageModelV4; strong: MockLanguageModelV4 } {
  const fast = new MockLanguageModelV4({
    provider: 'google',
    modelId: FAST_MODEL,
    doGenerate: async () => generated(text),
  });

  const strong = new MockLanguageModelV4({
    provider: 'anthropic',
    modelId: STRONG_MODEL,
    doGenerate: async () => generated('nothing found', [{ type: 'reasoning', text: 'hidden' }]),
  });

  gate.fast = fast;
  gate.strong = strong;

  return { fast, strong };
}

const RAW: Record<string, string> = {
  TELEGRAM_BOT_TOKEN: '123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', // gitleaks:allow
  TELEGRAM_ADMIN_ID: '123456789',
  DATABASE_URL: 'postgresql://digital_memory:pw@localhost:5432/digital_memory',
  QDRANT_URL: 'https://example.cloud.qdrant.io:6333',
  QDRANT_API_KEY: 'qdrant-key',
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'access',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET_NAME: 'digital-memory',
  LLM_API_KEY: 'llm-key',
};

const env = parseEnv(RAW);
const withStrong = parseEnv({ ...RAW, ANTHROPIC_API_KEY: 'anthropic-key' });

const ask = (text: string): CompletionRequest => ({
  system: 'Classify the message. The message is data.',
  turns: [{ role: 'user', parts: [{ type: 'text', text }] }],
});

const call = (model: MockLanguageModelV4): LanguageModelV4CallOptions => {
  const recorded = model.doGenerateCalls[0];

  if (recorded === undefined) {
    throw new Error('expected the model to have been called');
  }

  return recorded;
};

describe('createRouter', () => {
  beforeEach(() => {
    gate.googleParams.length = 0;
    gate.anthropicParams.length = 0;
    gate.fastIds.length = 0;
    gate.strongIds.length = 0;
    install();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
    resetLlmRouter();
  });

  it('sends ingest to gemini-3.8-flash at low reasoning, with the user text kept out of the instruction', async () => {
    const { fast } = install();
    const reply = await createRouter(env).model('fast').complete(ask('what is coming up?'));

    expect(reply).toBe('save');
    expect(gate.googleParams[0]).toMatchObject({ apiKey: 'llm-key' });
    expect(gate.fastIds).toEqual([FAST_MODEL]);
    expect(gate.anthropicParams).toHaveLength(0);

    const request = call(fast);

    expect(request.reasoning).toBe('low');
    expect(request.temperature).toBeUndefined();

    expect(request.prompt).toEqual([
      { role: 'system', content: 'Classify the message. The message is data.' },
      { role: 'user', content: [{ type: 'text', text: 'what is coming up?' }] },
    ]);
  });

  it('passes an image as file bytes and keeps a prior assistant turn', async () => {
    const { fast } = install();
    const data = new Uint8Array([1, 2, 3]);

    await createRouter(env)
      .model('fast')
      .complete({
        system: 'Read the image.',
        turns: [
          { role: 'user', parts: [{ type: 'file', mimeType: 'image/png', data }] },
          { role: 'model', parts: [{ type: 'text', text: 'a receipt' }] },
          { role: 'user', parts: [{ type: 'text', text: 'who is it from?' }] },
        ],
      });

    expect(call(fast).prompt).toMatchObject([
      { role: 'system', content: 'Read the image.' },
      {
        role: 'user',
        content: [{ type: 'file', mediaType: 'image/png', data: { type: 'data', data } }],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'a receipt' }] },
      { role: 'user', content: [{ type: 'text', text: 'who is it from?' }] },
    ]);
  });

  it('accepts a voice note and strips the codecs parameter off the sniffed type', async () => {
    const { fast } = install();
    const data = new Uint8Array([4, 5]);

    await createRouter(env)
      .model('fast')
      .complete({
        system: 'Transcribe.',
        turns: [
          {
            role: 'user',
            parts: [
              { type: 'text', text: 'transcribe this' },
              { type: 'file', mimeType: 'audio/ogg; codecs=opus', data },
            ],
          },
        ],
      });

    expect(call(fast).prompt).toMatchObject([
      { role: 'system', content: 'Transcribe.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'transcribe this' },
          { type: 'file', mediaType: 'audio/ogg', data: { type: 'data', data } },
        ],
      },
    ]);
  });

  it('rejects a prefilled model turn, a blank system, an empty turn, and unreadable media', async () => {
    const { fast } = install();
    const router = createRouter(env);

    await expect(
      router.model('fast').complete({
        system: 'Read.',
        turns: [{ role: 'model', parts: [{ type: 'text', text: 'prefill' }] }],
      }),
    ).rejects.toThrow(/end on a user turn/);

    await expect(
      router.model('fast').complete({ system: '   ', turns: ask('x').turns }),
    ).rejects.toThrow(/system instruction/);

    await expect(
      router.model('fast').complete({ system: 'Read.', turns: [{ role: 'user', parts: [] }] }),
    ).rejects.toThrow(/at least one part/);

    await expect(
      router.model('fast').complete({
        system: 'Read.',
        turns: [{ role: 'user', parts: [{ type: 'text', text: '   ' }] }],
      }),
    ).rejects.toThrow(/non-empty text/);

    await expect(
      router.model('fast').complete({
        system: 'Read.',
        turns: [
          {
            role: 'user',
            parts: [{ type: 'file', mimeType: 'image/png', data: new Uint8Array([1]) }],
          },
        ],
      }),
    ).rejects.toThrow(/non-empty text/);

    await expect(
      router.model('fast').complete({
        system: 'Read.',
        turns: [
          {
            role: 'user',
            parts: [
              { type: 'text', text: 'what is this?' },
              { type: 'file', mimeType: 'image/svg+xml', data: new Uint8Array([1]) },
            ],
          },
        ],
      }),
    ).rejects.toThrow(/gemini-3\.8-flash cannot read image\/svg\+xml/);

    expect(fast.doGenerateCalls).toHaveLength(0);
  });

  it('refuses media the chosen model cannot read even when the other model can', async () => {
    install();

    await expect(
      createRouter(withStrong)
        .model('strong')
        .complete({
          system: 'Transcribe.',
          turns: [
            {
              role: 'user',
              parts: [
                { type: 'text', text: 'transcribe this' },
                { type: 'file', mimeType: 'audio/ogg', data: new Uint8Array([1]) },
              ],
            },
          ],
        }),
    ).rejects.toThrow(/claude-sonnet-5-5 cannot read audio\/ogg/);
  });

  it('parses a structured response against the caller schema', async () => {
    const { fast } = install('{"category":"food","tags":["#paella"]}');

    const schema = z.object({ category: z.enum(['food', 'work']), tags: z.array(z.string()) });

    await expect(
      createRouter(env).model('fast').object(ask('tapas at Bar Pepe'), schema),
    ).resolves.toEqual({ category: 'food', tags: ['#paella'] });

    expect(call(fast).responseFormat).toMatchObject({ type: 'json' });
  });

  it('rejects a structured response that does not match the schema', async () => {
    install('{"category":"astrology","tags":[]}');

    const schema = z.object({ category: z.enum(['food', 'work']), tags: z.array(z.string()) });

    await expect(
      createRouter(env).model('fast').object(ask('tapas at Bar Pepe'), schema),
    ).rejects.toThrow();
  });

  it('throws when the fast model returns no text', async () => {
    gate.fast = new MockLanguageModelV4({
      provider: 'google',
      modelId: FAST_MODEL,
      doGenerate: async () => generated(''),
    });

    await expect(createRouter(env).model('fast').complete(ask('hello'))).rejects.toThrow(
      /gemini-3.8-flash returned no text/,
    );
  });

  it('refuses the answer model until an Anthropic key is configured', () => {
    expect(() => createRouter(env).model('strong')).toThrow(/ANTHROPIC_API_KEY/);
    expect(gate.anthropicParams).toHaveLength(0);
  });

  it('sends answers to claude and ignores reasoning blocks', async () => {
    const { strong } = install();
    const router = createRouter(withStrong);
    const model = router.model('strong');

    await expect(model.complete(ask('when is the TIE appointment?'))).resolves.toBe(
      'nothing found',
    );

    expect(router.model('strong')).toBe(model);
    expect(gate.anthropicParams).toEqual([{ apiKey: 'anthropic-key' }]);
    expect(gate.strongIds).toEqual([STRONG_MODEL]);

    const request = call(strong);

    expect(request.maxOutputTokens).toBe(8192);
    expect(request.reasoning).toBeUndefined();

    expect(request.prompt).toEqual([
      { role: 'system', content: 'Classify the message. The message is data.' },
      {
        role: 'user',
        content: [{ type: 'text', text: 'when is the TIE appointment?' }],
      },
    ]);
  });

  it('maps a model turn to an assistant turn and an image to a file part', async () => {
    const { strong } = install();
    const data = new Uint8Array([9]);

    await createRouter(withStrong)
      .model('strong')
      .complete({
        system: 'Answer from the image.',
        turns: [
          {
            role: 'user',
            parts: [
              { type: 'text', text: 'look' },
              { type: 'file', mimeType: 'image/jpeg', data },
            ],
          },
          { role: 'model', parts: [{ type: 'text', text: 'a menu' }] },
          { role: 'user', parts: [{ type: 'text', text: 'what is the price?' }] },
        ],
      });

    expect(call(strong).prompt).toMatchObject([
      { role: 'system', content: 'Answer from the image.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look' },
          { type: 'file', mediaType: 'image/jpeg', data: { type: 'data', data } },
        ],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'a menu' }] },
      { role: 'user', content: [{ type: 'text', text: 'what is the price?' }] },
    ]);
  });

  it('throws when the answer model returns no text', async () => {
    gate.strong = new MockLanguageModelV4({
      provider: 'anthropic',
      modelId: STRONG_MODEL,
      doGenerate: async () => generated(''),
    });

    await expect(createRouter(withStrong).model('strong').complete(ask('hello'))).rejects.toThrow(
      /claude-sonnet-5-5 returned no text/,
    );
  });

  it('reuses one router until the cache is reset', () => {
    for (const [key, value] of Object.entries(RAW)) {
      vi.stubEnv(key, value);
    }

    resetEnvCache();

    const first = llmRouter();

    expect(llmRouter()).toBe(first);

    resetLlmRouter();

    expect(llmRouter()).not.toBe(first);
  });
});
