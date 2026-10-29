import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { embedMany as embedManyValues } from 'ai';
import type { Env } from '../../config/env.ts';
import { getEnv } from '../../config/env.ts';
import { logger } from '../logging/logger.ts';
import { DENSE_VECTOR_SIZE } from '../vector/vector-store.ts';

const log = logger.child({ module: 'llm/embeddings' });

export const EMBEDDING_MODEL = 'gemini-embedding-2';

export type EmbedTask = 'document' | 'query';

export interface Embeddings {
  embed(text: string, task: EmbedTask): Promise<number[]>;
  embedMany(texts: readonly string[], task: EmbedTask): Promise<number[][]>;
}

const TASK_PREFIX = {
  document: (text: string) => `title: none | text: ${text}`,
  query: (text: string) => `task: search result | query: ${text}`,
} as const satisfies Record<EmbedTask, (text: string) => string>;

function requireText(text: string): string {
  if (text.trim().length === 0) {
    throw new TypeError('Cannot embed blank text');
  }

  return text;
}

function fitted(values: number[] | undefined, index: number): number[] {
  if (values === undefined || values.length !== DENSE_VECTOR_SIZE) {
    throw new TypeError(
      `Embedding ${index} width ${values?.length ?? 0} does not match the collection's ${DENSE_VECTOR_SIZE}`,
    );
  }

  return values;
}

export function createEmbeddings(env: Env = getEnv()): Embeddings {
  const google = createGoogleGenerativeAI({ apiKey: env.LLM_FAST_API_KEY });
  const model = google.embedding(EMBEDDING_MODEL);

  async function embedMany(texts: readonly string[], task: EmbedTask): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const values = texts.map((text) => TASK_PREFIX[task](requireText(text)));

    const { embeddings } = await embedManyValues({
      model,
      values,
      providerOptions: { google: { outputDimensionality: DENSE_VECTOR_SIZE } },
    });

    if (embeddings.length !== values.length) {
      throw new TypeError(`Expected ${values.length} embeddings and received ${embeddings.length}`);
    }

    log.debug('embedded', { model: EMBEDDING_MODEL, count: values.length, task });

    return embeddings.map((embedding, index) => fitted(embedding, index));
  }

  async function embed(text: string, task: EmbedTask): Promise<number[]> {
    const [vector] = await embedMany([text], task);

    return vector ?? fitted(undefined, 0);
  }

  return { embed, embedMany };
}

let shared: Embeddings | undefined;

export function embeddings(): Embeddings {
  shared ??= createEmbeddings();

  return shared;
}

export function resetEmbeddings(): void {
  shared = undefined;
}
