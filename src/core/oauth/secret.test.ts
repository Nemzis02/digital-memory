import { describe, expect, it } from 'vitest';
import { hashSecret, newSecret } from './secret.ts';

describe('newSecret', () => {
  it('gives 43 base64url characters that differ between calls', () => {
    const first = newSecret();
    const second = newSecret();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
  });
});

describe('hashSecret', () => {
  it('is a deterministic 64-character hex digest', () => {
    const hash = hashSecret('secret');

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSecret('secret')).toBe(hash);
    expect(hashSecret('other')).not.toBe(hash);
  });
});
