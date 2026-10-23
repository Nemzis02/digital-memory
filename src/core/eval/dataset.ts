import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { AGENT_TOOL_NAMES } from '../agent/tools.ts';
import { tagSlug } from '../memory/normalize.ts';
import { MEMORY_TYPES, memoryPayloadSchema } from '../memory/payload.ts';

export const DEFAULT_EVALS_DIR = resolve(import.meta.dirname, '../../../evals');

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'a key is a lowercase slug');

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

const corpusMetadata = memoryPayloadSchema.shape.metadata.refine(
  (metadata) =>
    metadata.tags.every((tag) => tag === tagSlug(tag) && tag !== `#${metadata.category}`),
  { error: 'tags must be #slugs and must not repeat the category', path: ['tags'] },
);

export const corpusRowSchema = z
  .strictObject({
    key: slug,
    type: z.enum(MEMORY_TYPES).default('text'),
    text: z.string().min(1),
    summary: z.string().min(1),
    source_url: z.url().optional(),
    metadata: corpusMetadata,
    event_at: z.iso.date().optional(),
  })
  .refine((row) => row.type !== 'url' || row.source_url !== undefined, {
    error: 'a url memory must keep its link',
    path: ['source_url'],
  });

export const retrievalCaseSchema = z.strictObject({
  key: slug,
  query: z.string().min(1),
  expected: z.array(slug).max(3).refine(unique, { error: 'expected keys repeat' }),
});

export const turnCaseSchema = z.strictObject({
  key: slug,
  message: z.string().min(1),
  context: z
    .array(
      z.strictObject({
        role: z.enum(['user', 'assistant']),
        body: z.string().min(1),
      }),
    )
    .default([]),
  expected: z.array(z.enum(AGENT_TOOL_NAMES)).refine(unique, { error: 'expected tools repeat' }),
});

export type CorpusRow = z.infer<typeof corpusRowSchema>;

export type RetrievalCase = z.infer<typeof retrievalCaseSchema>;

export type TurnCase = z.infer<typeof turnCaseSchema>;

export interface EvalDataset {
  corpus: CorpusRow[];
  retrieval: RetrievalCase[];
  turns: TurnCase[];
}

export function parseJsonl<S extends z.ZodType>(
  name: string,
  text: string,
  schema: S,
): z.output<S>[] {
  const rows: z.output<S>[] = [];

  for (const [index, line] of text.split('\n').entries()) {
    if (line.trim() === '') {
      continue;
    }

    let value: unknown;

    try {
      value = JSON.parse(line);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      throw new TypeError(`${name} line ${String(index + 1)} is not JSON: ${reason}`, {
        cause: error,
      });
    }

    const result = schema.safeParse(value);

    if (!result.success) {
      throw new TypeError(
        `Invalid ${name} line ${String(index + 1)}:\n${z.prettifyError(result.error)}`,
      );
    }

    rows.push(result.data);
  }

  return rows;
}

function requireUniqueKeys(name: string, rows: readonly { key: string }[]): void {
  const seen = new Set<string>();

  for (const { key } of rows) {
    if (seen.has(key)) {
      throw new TypeError(`${name} repeats the key ${key}`);
    }

    seen.add(key);
  }
}

export function buildDataset(files: EvalDataset): EvalDataset {
  requireUniqueKeys('corpus.jsonl', files.corpus);
  requireUniqueKeys('retrieval.jsonl', files.retrieval);
  requireUniqueKeys('turns.jsonl', files.turns);

  const corpusKeys = new Set(files.corpus.map((row) => row.key));

  for (const testCase of files.retrieval) {
    const missing = testCase.expected.find((key) => !corpusKeys.has(key));

    if (missing !== undefined) {
      throw new TypeError(`retrieval case ${testCase.key} expects ${missing}, not in the corpus`);
    }
  }

  return files;
}

export async function loadDataset(dir = DEFAULT_EVALS_DIR): Promise<EvalDataset> {
  const read = (name: string) => readFile(join(dir, name), 'utf8');

  const [corpus, retrieval, turns] = await Promise.all([
    read('corpus.jsonl'),
    read('retrieval.jsonl'),
    read('turns.jsonl'),
  ]);

  return buildDataset({
    corpus: parseJsonl('corpus.jsonl', corpus, corpusRowSchema),
    retrieval: parseJsonl('retrieval.jsonl', retrieval, retrievalCaseSchema),
    turns: parseJsonl('turns.jsonl', turns, turnCaseSchema),
  });
}
