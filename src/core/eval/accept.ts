import { DEFAULT_EVALS_DIR } from './dataset.ts';
import { acceptBaseline, BASELINE_FILE } from './report.ts';

const run = await acceptBaseline(DEFAULT_EVALS_DIR);

console.log(
  `${BASELINE_FILE} now holds the run of ${run.ran_at}: retrieval ${run.retrieval.total.toFixed(2)}, turns ${run.turns.total.toFixed(2)}.`,
);
