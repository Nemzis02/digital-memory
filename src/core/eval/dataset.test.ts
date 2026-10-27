import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AGENT_TOOL_NAMES } from '../agent/tools.ts';
import { MEMORY_CATEGORIES, MEMORY_KINDS, MEMORY_TYPES } from '../memory/payload.ts';
import {
  buildDataset,
  corpusRowSchema,
  DEFAULT_EVALS_DIR,
  loadDataset,
  parseJsonl,
  retrievalCaseSchema,
  turnCaseSchema,
  type CorpusRow,
  type EvalDataset,
} from './dataset.ts';

const dentist = {
  key: 'dentist',
  text: 'Dentist on Calle Colon, 14 March at 10:00',
  summary: 'Dentist appointment on 14 March',
  metadata: { category: 'health', kind: 'event', tags: ['#dentist'] },
  event_at: '2026-03-14',
};

const tapas = {
  key: 'tapas-bar',
  type: 'url',
  text: 'Bar Central serves the best tapas in Valencia.',
  summary: 'Tapas bar in Valencia',
  source_url: 'https://example.com/bar-central',
  metadata: { category: 'food', kind: 'recommendation', location: 'Valencia', tags: ['#tapas'] },
};

function lines(...rows: readonly unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join('\n');
}

function corpusRow(value: unknown): CorpusRow {
  return corpusRowSchema.parse(value);
}

describe('parseJsonl', () => {
  it('parses each row and skips blank and trailing lines', () => {
    const text = `${JSON.stringify(tapas)}\n\n${JSON.stringify(dentist)}\n`;

    expect(parseJsonl('corpus.jsonl', text, corpusRowSchema)).toStrictEqual([
      tapas,
      { ...dentist, type: 'text' },
    ]);
  });

  it('defaults a missing turn context to none', () => {
    const text = lines({ key: 'hello', message: 'Hi', expected: [] });

    expect(parseJsonl('turns.jsonl', text, turnCaseSchema)).toStrictEqual([
      { key: 'hello', message: 'Hi', context: [], expected: [] },
    ]);
  });

  it('names the file and line of a row that is not JSON', () => {
    const text = `${JSON.stringify(dentist)}\n{oops`;

    expect(() => parseJsonl('corpus.jsonl', text, corpusRowSchema)).toThrow(
      /^corpus\.jsonl line 2 is not JSON/,
    );
  });

  it('names the file and line of a row the schema rejects', () => {
    const text = `\n${JSON.stringify({ ...dentist, key: 'Bad Key' })}`;

    expect(() => parseJsonl('corpus.jsonl', text, corpusRowSchema)).toThrow(
      /^Invalid corpus\.jsonl line 2:\n.*lowercase slug/,
    );
  });
});

describe('corpusRowSchema', () => {
  it('rejects a url memory without its link', () => {
    const { source_url: _, ...unlinked } = tapas;

    expect(() => corpusRow(unlinked)).toThrow(/must keep its link/);
  });

  it('rejects a key it does not know', () => {
    expect(() => corpusRow({ ...dentist, mood: 'calm' })).toThrow(/mood/);
  });

  it('rejects a tag that is not a #slug', () => {
    const metadata = { ...dentist.metadata, tags: ['Dentist Visit'] };

    expect(() => corpusRow({ ...dentist, metadata })).toThrow(/#slugs/);
  });

  it('rejects a tag that repeats the category', () => {
    const metadata = { ...dentist.metadata, tags: ['#health'] };

    expect(() => corpusRow({ ...dentist, metadata })).toThrow(/repeat the category/);
  });
});

describe('retrievalCaseSchema', () => {
  it('accepts a query with no right answer', () => {
    const noAnswer = { key: 'piano', query: 'piano lessons', expected: [] };

    expect(retrievalCaseSchema.parse(noAnswer)).toStrictEqual(noAnswer);
  });

  it('rejects more than three expected keys', () => {
    const many = { key: 'q', query: 'q', expected: ['a', 'b', 'c', 'd'] };

    expect(() => retrievalCaseSchema.parse(many)).toThrow();
  });

  it('rejects a repeated expected key', () => {
    const repeated = { key: 'q', query: 'q', expected: ['a', 'a'] };

    expect(() => retrievalCaseSchema.parse(repeated)).toThrow(/expected keys repeat/);
  });
});

describe('turnCaseSchema', () => {
  it('rejects a tool the agent does not have', () => {
    const unknown = { key: 't', message: 'Hi', expected: ['delete_everything'] };

    expect(() => turnCaseSchema.parse(unknown)).toThrow();
  });

  it('rejects a repeated expected tool', () => {
    const repeated = { key: 't', message: 'Hi', expected: ['save_memory', 'save_memory'] };

    expect(() => turnCaseSchema.parse(repeated)).toThrow(/expected tools repeat/);
  });
});

describe('buildDataset', () => {
  const corpus = [corpusRow(dentist), corpusRow(tapas)];

  const retrieval = [
    { key: 'teeth', query: 'when is my teeth appointment', expected: ['dentist'] },
  ];

  const turns = [turnCaseSchema.parse({ key: 'save', message: 'Save', expected: ['save_memory'] })];

  it('returns the rows unchanged when every key checks out', () => {
    expect(buildDataset({ corpus, retrieval, turns })).toStrictEqual({ corpus, retrieval, turns });
  });

  it('rejects a corpus key used twice', () => {
    expect(() =>
      buildDataset({ corpus: [...corpus, corpusRow(dentist)], retrieval: [], turns: [] }),
    ).toThrow('corpus.jsonl repeats the key dentist');
  });

  it('rejects a retrieval case that expects a key not in the corpus', () => {
    const lost = [{ key: 'lost', query: 'q', expected: ['dentist', 'gym'] }];

    expect(() => buildDataset({ corpus, retrieval: lost, turns: [] })).toThrow(
      'retrieval case lost expects gym, not in the corpus',
    );
  });
});

describe('loadDataset', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('reads and checks the three files of a directory', async () => {
    dir = await mkdtemp(join(tmpdir(), 'evals-'));

    await writeFile(join(dir, 'corpus.jsonl'), lines(dentist));

    await writeFile(
      join(dir, 'retrieval.jsonl'),
      lines({ key: 'q', query: 'q', expected: ['dentist'] }),
    );

    await writeFile(join(dir, 'turns.jsonl'), lines({ key: 't', message: 'Hi', expected: [] }));

    expect(await loadDataset(dir)).toStrictEqual({
      corpus: [{ ...dentist, type: 'text' }],
      retrieval: [{ key: 'q', query: 'q', expected: ['dentist'] }],
      turns: [{ key: 't', message: 'Hi', context: [], expected: [] }],
    });
  });

  it('fails when a file is missing', async () => {
    dir = await mkdtemp(join(tmpdir(), 'evals-'));

    await expect(loadDataset(dir)).rejects.toThrow(/ENOENT/);
  });
});

describe('DEFAULT_EVALS_DIR', () => {
  it('points at evals/ in the repository root', () => {
    expect(basename(DEFAULT_EVALS_DIR)).toBe('evals');
    expect(existsSync(join(dirname(DEFAULT_EVALS_DIR), 'package.json'))).toBe(true);
  });
});

describe('the committed golden set', () => {
  let dataset: EvalDataset;

  beforeAll(async () => {
    dataset = await loadDataset();
  });

  it('has the number of rows the plan asks for', async () => {
    const { corpus, retrieval, turns } = dataset;

    expect(corpus.length).toBeGreaterThanOrEqual(40);
    expect(corpus.length).toBeLessThanOrEqual(60);
    expect(retrieval.length).toBeGreaterThanOrEqual(30);
    expect(retrieval.length).toBeLessThanOrEqual(40);
    expect(turns.length).toBeGreaterThanOrEqual(20);
    expect(turns.length).toBeLessThanOrEqual(30);
  });

  it('covers every category, kind and type', async () => {
    const { corpus } = dataset;

    expect(new Set(corpus.map((row) => row.metadata.category))).toStrictEqual(
      new Set(MEMORY_CATEGORIES),
    );

    expect(new Set(corpus.map((row) => row.metadata.kind))).toStrictEqual(new Set(MEMORY_KINDS));
    expect(new Set(corpus.map((row) => row.type))).toStrictEqual(new Set(MEMORY_TYPES));
  });

  it('plants one memory that gives instructions', async () => {
    const { corpus } = dataset;

    expect(corpus.filter((row) => /ignore previous instructions/i.test(row.text))).toHaveLength(1);
  });

  it('asks two queries that have no right answer', async () => {
    const { retrieval } = dataset;

    expect(retrieval.filter((testCase) => testCase.expected.length === 0)).toHaveLength(2);
  });

  it('expects every tool at least once and some turns without a tool', async () => {
    const { turns } = dataset;
    const expected = new Set(turns.flatMap((testCase) => testCase.expected));

    expect(expected).toStrictEqual(new Set(AGENT_TOOL_NAMES));
    expect(turns.some((testCase) => testCase.expected.length === 0)).toBe(true);
    expect(turns.some((testCase) => testCase.context.length > 0)).toBe(true);
  });
});
