import { describe, expect, it } from 'vitest';
import { recallAtK, toolChoice } from './score.ts';

describe('recallAtK', () => {
  it('scores 1 when every expected key is in the top k', () => {
    expect(recallAtK(['a', 'b', 'c'], ['b', 'a'], 3)).toBe(1);
  });

  it('scores the share of expected keys found', () => {
    expect(recallAtK(['a', 'x', 'y'], ['a', 'b'], 3)).toBe(0.5);
  });

  it('ignores a key retrieved after position k', () => {
    expect(recallAtK(['x', 'y', 'a'], ['a'], 2)).toBe(0);
  });

  it('does not let a repeated key take a slot', () => {
    expect(recallAtK(['a', 'a', 'a', 'b'], ['b'], 2)).toBe(1);
  });

  it('counts a repeated expected key once', () => {
    expect(recallAtK(['a'], ['a', 'a', 'b'], 5)).toBe(0.5);
  });

  it('scores fewer results than k on what came back', () => {
    expect(recallAtK(['a'], ['a', 'b'], 5)).toBe(0.5);
  });

  it('scores 0 when nothing comes back for a case with an answer', () => {
    expect(recallAtK([], ['a'], 5)).toBe(0);
  });

  it('scores a case with no answer 1 only when nothing comes back', () => {
    expect(recallAtK([], [], 5)).toBe(1);
    expect(recallAtK(['a'], [], 5)).toBe(0);
  });

  it('rejects a k that is not a positive integer', () => {
    expect(() => recallAtK(['a'], ['a'], 0)).toThrow(RangeError);
    expect(() => recallAtK(['a'], ['a'], 1.5)).toThrow(RangeError);
  });
});

describe('toolChoice', () => {
  it('scores 1 for the expected tools in any order', () => {
    expect(toolChoice(['save_memory', 'search_memory'], ['search_memory', 'save_memory'])).toBe(1);
  });

  it('accepts an extra search and repeated calls', () => {
    expect(toolChoice(['search_memory', 'save_memory', 'save_memory'], ['save_memory'])).toBe(1);
  });

  it('scores 0 when an expected tool is missing', () => {
    expect(toolChoice(['search_memory'], ['search_memory', 'save_memory'])).toBe(0);
  });

  it('scores 0 when a wrong tool takes the place of the expected one', () => {
    expect(toolChoice(['list_memories'], ['search_memory'])).toBe(0);
  });

  it('scores 0 for an extra tool other than search', () => {
    expect(toolChoice(['search_memory', 'list_memories'], ['search_memory'])).toBe(0);
  });

  it('lets a turn that needs no tool only search', () => {
    expect(toolChoice([], [])).toBe(1);
    expect(toolChoice(['search_memory'], [])).toBe(1);
    expect(toolChoice(['save_memory'], [])).toBe(0);
  });
});
