import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acceptBaseline,
  BASELINE_FILE,
  buildRun,
  compareRuns,
  LAST_RUN_FILE,
  readRun,
  renderTable,
  writeRun,
  type EvalRun,
} from './report.ts';

const MODELS = { strong: 'strong-model', embedding: 'embedding-model' };

function run(retrieval: Record<string, number>, turns: Record<string, number>): EvalRun {
  return buildRun({ ranAt: new Date('2026-10-27T08:00:00Z'), models: MODELS, retrieval, turns });
}

describe('buildRun', () => {
  it('averages each suite and rounds to four places', () => {
    const built = run({ a: 1, b: 1 / 3 }, { t: 0 });

    expect(built).toStrictEqual({
      ran_at: '2026-10-27T08:00:00.000Z',
      models: MODELS,
      retrieval: { total: 0.6667, cases: { a: 1, b: 0.3333 } },
      turns: { total: 0, cases: { t: 0 } },
    });
  });

  it('gives an empty suite a total of 0', () => {
    expect(run({}, {}).turns).toStrictEqual({ total: 0, cases: {} });
  });

  it('rejects a score outside 0 to 1', () => {
    expect(() => run({ a: 2 }, {})).toThrow();
  });
});

describe('compareRuns', () => {
  it('shows each case and the total against the baseline', () => {
    const baseline = run({ a: 0.5, b: 1 }, { t: 1 });
    const current = run({ a: 1, b: 0.5, c: 1 }, { t: 1 });

    expect(compareRuns(current, baseline)).toStrictEqual([
      { suite: 'retrieval', key: 'a', score: 1, baseline: 0.5, delta: 0.5 },
      { suite: 'retrieval', key: 'b', score: 0.5, baseline: 1, delta: -0.5 },
      { suite: 'retrieval', key: 'c', score: 1 },
      { suite: 'retrieval', key: 'total', score: 0.8333, baseline: 0.75, delta: 0.0833 },
      { suite: 'turns', key: 't', score: 1, baseline: 1, delta: 0 },
      { suite: 'turns', key: 'total', score: 1, baseline: 1, delta: 0 },
    ]);
  });

  it('leaves the baseline out when there is none', () => {
    expect(compareRuns(run({ a: 1 }, {}))).toStrictEqual([
      { suite: 'retrieval', key: 'a', score: 1 },
      { suite: 'retrieval', key: 'total', score: 1 },
      { suite: 'turns', key: 'total', score: 0 },
    ]);
  });
});

describe('renderTable', () => {
  it('aligns the columns, signs a gain and dashes a missing baseline', () => {
    const table = renderTable([
      { suite: 'retrieval', key: 'dentist-keyword', score: 1, baseline: 0.5, delta: 0.5 },
      { suite: 'turns', key: 'save', score: 0, baseline: 1, delta: -1 },
      { suite: 'turns', key: 'new', score: 1 },
    ]);

    expect(table.split('\n')).toStrictEqual([
      'suite      case             score  baseline  delta',
      'retrieval  dentist-keyword   1.00      0.50  +0.50',
      'turns      save              0.00      1.00  -1.00',
      'turns      new               1.00         -      -',
    ]);
  });
});

describe('run files', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('reads back what it wrote and reads a missing file as no run', async () => {
    dir = await mkdtemp(join(tmpdir(), 'eval-run-'));

    const path = join(dir, LAST_RUN_FILE);
    const written = run({ a: 1 }, { t: 0 });

    expect(await readRun(path)).toBeUndefined();

    await writeRun(path, written);

    expect(await readRun(path)).toStrictEqual(written);
  });

  it('names the file of a run that does not match the schema', async () => {
    dir = await mkdtemp(join(tmpdir(), 'eval-run-'));

    const path = join(dir, BASELINE_FILE);

    await writeFile(path, '{"ran_at":"yesterday"}');

    await expect(readRun(path)).rejects.toThrow(/^Invalid eval run in .*baseline\.json/);
  });

  it('copies the last run to the baseline', async () => {
    dir = await mkdtemp(join(tmpdir(), 'eval-run-'));

    const last = run({ a: 0.5 }, { t: 1 });

    await writeRun(join(dir, LAST_RUN_FILE), last);

    expect(await acceptBaseline(dir)).toStrictEqual(last);

    expect(await readFile(join(dir, BASELINE_FILE), 'utf8')).toBe(
      await readFile(join(dir, LAST_RUN_FILE), 'utf8'),
    );
  });

  it('refuses to accept when there is no last run', async () => {
    dir = await mkdtemp(join(tmpdir(), 'eval-run-'));

    await expect(acceptBaseline(dir)).rejects.toThrow(/last-run\.json does not exist/);
  });
});
