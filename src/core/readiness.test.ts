import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withinDeadline } from './readiness.ts';

describe('withinDeadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes the value through when the work settles in time', async () => {
    await expect(withinDeadline(Promise.resolve(1), 10, 'fast')).resolves.toBe(1);
  });

  it('rejects with the label once the deadline passes', async () => {
    const pending = withinDeadline(new Promise<never>(() => {}), 10, 'postgres');
    const outcome = expect(pending).rejects.toThrow('postgres did not answer within 10 ms');

    await vi.advanceTimersByTimeAsync(10);
    await outcome;
  });
});
