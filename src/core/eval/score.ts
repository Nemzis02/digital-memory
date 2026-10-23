import type { AgentToolName } from '../agent/tools.ts';

export function recallAtK(
  retrieved: readonly string[],
  expected: readonly string[],
  k: number,
): number {
  if (!Number.isInteger(k) || k < 1) {
    throw new RangeError(`k must be a positive integer, got ${String(k)}`);
  }

  const top = new Set([...new Set(retrieved)].slice(0, k));

  if (expected.length === 0) {
    return top.size === 0 ? 1 : 0;
  }

  const wanted = new Set(expected);
  let found = 0;

  for (const key of wanted) {
    if (top.has(key)) {
      found += 1;
    }
  }

  return found / wanted.size;
}

export function toolChoice(called: readonly string[], expected: readonly AgentToolName[]): 0 | 1 {
  const wanted = new Set<string>(expected);
  const got = new Set(called);

  const allCalled = [...wanted].every((name) => got.has(name));
  const noneWrong = [...got].every((name) => wanted.has(name) || name === 'search_memory');

  return allCalled && noneWrong ? 1 : 0;
}
