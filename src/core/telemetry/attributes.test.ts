import { describe, expect, it } from 'vitest';
import { hashRef, turnAttributes } from './attributes.ts';

describe('hashRef', () => {
  it('returns 16 lowercase hex characters and is stable', () => {
    expect(hashRef('123456789')).toMatch(/^[0-9a-f]{16}$/);
    expect(hashRef('123456789')).toBe(hashRef('123456789'));
  });

  it('separates neighbouring refs and does not contain the ref', () => {
    expect(hashRef('7')).not.toBe(hashRef('8'));
    expect(hashRef('123456789')).not.toContain('123456789');
  });
});

describe('turnAttributes', () => {
  it('carries the source and only hashed chat and user refs', () => {
    const attributes = turnAttributes({ source: 'telegram', chatRef: '7', userRef: '42' });

    expect(attributes).toStrictEqual({
      userId: hashRef('42'),
      sessionId: hashRef('7'),
      tags: ['telegram'],
      metadata: { source: 'telegram', chat: hashRef('7') },
    });

    expect(JSON.stringify(attributes)).not.toMatch(/"(7|42)"/);
  });
});
