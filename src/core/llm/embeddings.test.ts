import type { EmbeddingModelV4CallOptions } from '@ai-sdk/provider';
import { MockEmbeddingModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnv, resetEnvCache } from '../../config/env.ts';
import { DENSE_VECTOR_SIZE } from '../vector/vector-store.ts';
import {
  createEmbeddings,
  EMBEDDING_MODEL,
  embeddings,
  embedSparse,
  resetEmbeddings,
} from './embeddings.ts';

const gate = vi.hoisted(() => ({
  googleParams: [] as { apiKey?: string }[],
  embeddingIds: [] as string[],
  embedding: undefined as MockEmbeddingModelV4 | undefined,
}));

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: (options: { apiKey?: string }) => {
    gate.googleParams.push(options);

    return {
      embedding(modelId: string) {
        gate.embeddingIds.push(modelId);

        if (gate.embedding === undefined) {
          throw new Error('embedding mock was not installed');
        }

        return gate.embedding;
      },
    };
  },
}));

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

const dense = (fill = 0.1): number[] => new Array<number>(DENSE_VECTOR_SIZE).fill(fill);

function installEmbedding(
  embed: (values: string[]) => number[][] = (values) => values.map(() => dense()),
): MockEmbeddingModelV4 {
  const model = new MockEmbeddingModelV4({
    provider: 'google',
    modelId: EMBEDDING_MODEL,
    maxEmbeddingsPerCall: 64,
    async doEmbed({ values }) {
      return { embeddings: embed(values), warnings: [] };
    },
  });

  gate.embedding = model;

  return model;
}

const sentValues = (model: MockEmbeddingModelV4): string[] =>
  model.doEmbedCalls.flatMap((call: EmbeddingModelV4CallOptions) => call.values);

describe('embedSparse', () => {
  it('folds case and counts repeated tokens', () => {
    expect(embedSparse('Valencia Valencia')).toEqual(embedSparse('valencia valencia'));
    expect(embedSparse('Valencia Valencia').values).toEqual([2]);
  });

  it('keeps accented words intact and returns indices in ascending order', () => {
    const vector = embedSparse('beta niño niño alpha');

    expect(vector.indices).toHaveLength(3);
    expect(vector.indices).toEqual([...vector.indices].sort((a, b) => a - b));
    expect(vector.values.reduce((sum, value) => sum + value, 0)).toBe(4);
  });

  it('rejects text that contains no tokens', () => {
    expect(() => embedSparse('... ---')).toThrow(/blank text/);
  });
});

describe('createEmbeddings', () => {
  beforeEach(() => {
    gate.googleParams.length = 0;
    gate.embeddingIds.length = 0;
    gate.embedding = undefined;
    installEmbedding();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
    resetEmbeddings();
  });

  it('prefixes a document and asks for the collection width', async () => {
    const model = installEmbedding();
    const vector = await createEmbeddings(env).embed('cita previa', 'document');

    expect(vector).toHaveLength(DENSE_VECTOR_SIZE);
    expect(gate.googleParams[0]).toMatchObject({ apiKey: 'llm-key' });
    expect(gate.embeddingIds).toEqual([EMBEDDING_MODEL]);
    expect(sentValues(model)).toEqual(['title: none | text: cita previa']);

    expect(model.doEmbedCalls[0]?.providerOptions).toMatchObject({
      google: { outputDimensionality: DENSE_VECTOR_SIZE },
    });

    expect(JSON.stringify(model.doEmbedCalls[0]?.providerOptions)).not.toContain('taskType');
  });

  it('prefixes each question and returns one vector per input', async () => {
    const model = installEmbedding((values) =>
      values.map((_, index) => dense(index === 0 ? 0.1 : 0.2)),
    );

    const vectors = await createEmbeddings(env).embedMany(['one', 'two'], 'query');

    expect(vectors).toHaveLength(2);
    expect(vectors[0]?.[0]).toBe(0.1);
    expect(vectors[1]?.[0]).toBe(0.2);

    expect(sentValues(model)).toEqual([
      'task: search result | query: one',
      'task: search result | query: two',
    ]);
  });

  it('skips the model when there is nothing to embed', async () => {
    const model = installEmbedding();

    await expect(createEmbeddings(env).embedMany([], 'document')).resolves.toEqual([]);
    expect(model.doEmbedCalls).toHaveLength(0);
  });

  it('refuses blank text before spending a request', async () => {
    const model = installEmbedding();

    await expect(createEmbeddings(env).embed('   ', 'document')).rejects.toThrow(/blank text/);
    expect(model.doEmbedCalls).toHaveLength(0);
  });

  it('rejects a vector whose width would not fit the collection', async () => {
    installEmbedding(() => [[0.1, 0.2]]);

    await expect(createEmbeddings(env).embed('cita', 'document')).rejects.toThrow(
      /width 2 does not match the collection's 1536/,
    );
  });

  it('rejects a batch that comes back short', async () => {
    installEmbedding(() => []);

    await expect(createEmbeddings(env).embedMany(['one'], 'document')).rejects.toThrow(
      /received 0/,
    );
  });

  it('reuses one client until the cache is reset', () => {
    for (const [key, value] of Object.entries(RAW)) {
      vi.stubEnv(key, value);
    }

    resetEnvCache();

    const first = embeddings();

    expect(embeddings()).toBe(first);

    resetEmbeddings();

    expect(embeddings()).not.toBe(first);
  });
});
