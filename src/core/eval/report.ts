import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

export const LAST_RUN_FILE = 'last-run.json';
export const BASELINE_FILE = 'baseline.json';

const score = z.number().min(0).max(1);

const suiteSchema = z.strictObject({
  total: score,
  cases: z.record(z.string(), score),
});

export const evalRunSchema = z.strictObject({
  ran_at: z.iso.datetime(),
  models: z.strictObject({ strong: z.string().min(1), embedding: z.string().min(1) }),
  retrieval: suiteSchema,
  turns: suiteSchema,
});

export type EvalRun = z.infer<typeof evalRunSchema>;

export type SuiteName = 'retrieval' | 'turns';

const SUITES: readonly SuiteName[] = ['retrieval', 'turns'];

export const TOTAL_ROW = 'total';

export interface ReportRow {
  suite: SuiteName;
  key: string;
  score: number;
  baseline?: number;
  delta?: number;
}

function rounded(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : rounded(values.reduce((sum, v) => sum + v, 0) / values.length);
}

export interface RunInput {
  ranAt: Date;
  models: EvalRun['models'];
  retrieval: Readonly<Record<string, number>>;
  turns: Readonly<Record<string, number>>;
}

export function buildRun(input: RunInput): EvalRun {
  const suite = (cases: Readonly<Record<string, number>>) => ({
    total: mean(Object.values(cases)),
    cases: Object.fromEntries(Object.entries(cases).map(([key, value]) => [key, rounded(value)])),
  });

  return evalRunSchema.parse({
    ran_at: input.ranAt.toISOString(),
    models: input.models,
    retrieval: suite(input.retrieval),
    turns: suite(input.turns),
  });
}

function row(suite: SuiteName, key: string, value: number, baseline: number | undefined) {
  return {
    suite,
    key,
    score: value,
    ...(baseline === undefined ? {} : { baseline, delta: rounded(value - baseline) }),
  };
}

/** One row per case of the run, then the suite total; a case new since the baseline has none. */
export function compareRuns(run: EvalRun, baseline?: EvalRun): ReportRow[] {
  return SUITES.flatMap((suite) => [
    ...Object.entries(run[suite].cases).map(([key, value]) =>
      row(suite, key, value, baseline?.[suite].cases[key]),
    ),
    row(suite, TOTAL_ROW, run[suite].total, baseline?.[suite].total),
  ]);
}

function fixed(value: number | undefined): string {
  return value === undefined ? '-' : value.toFixed(2);
}

function signed(value: number | undefined): string {
  if (value === undefined) {
    return '-';
  }

  return value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}

export function renderTable(rows: readonly ReportRow[]): string {
  const header = ['suite', 'case', 'score', 'baseline', 'delta'];

  const cells = rows.map((r) => [
    r.suite,
    r.key,
    fixed(r.score),
    fixed(r.baseline),
    signed(r.delta),
  ]);

  const widths = header.map((title, column) =>
    Math.max(title.length, ...cells.map((line) => line[column]?.length ?? 0)),
  );

  return [header, ...cells]
    .map((line) =>
      line
        .map((cell, column) =>
          column < 2 ? cell.padEnd(widths[column] ?? 0) : cell.padStart(widths[column] ?? 0),
        )
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

export async function readRun(path: string): Promise<EvalRun | undefined> {
  let text: string;

  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }

  const result = evalRunSchema.safeParse(JSON.parse(text));

  if (!result.success) {
    throw new TypeError(`Invalid eval run in ${path}:\n${z.prettifyError(result.error)}`);
  }

  return result.data;
}

export async function writeRun(path: string, run: EvalRun): Promise<void> {
  await writeFile(path, `${JSON.stringify(run, null, 2)}\n`);
}

/** Makes the last run the baseline that later runs compare against. */
export async function acceptBaseline(dir: string): Promise<EvalRun> {
  const run = await readRun(join(dir, LAST_RUN_FILE));

  if (run === undefined) {
    throw new Error(`${LAST_RUN_FILE} does not exist in ${dir}. Run npm run eval first.`);
  }

  await writeRun(join(dir, BASELINE_FILE), run);

  return run;
}
