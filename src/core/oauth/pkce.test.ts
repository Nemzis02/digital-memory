import { describe, expect, it } from 'vitest';
import { challengeFor, isCodeChallenge, newVerifier } from './pkce.ts';

describe('challengeFor', () => {
  it('matches the RFC 7636 appendix B vector', () => {
    expect(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('newVerifier', () => {
  it('is 43 unreserved characters and differs each time', () => {
    const first = newVerifier();
    const second = newVerifier();

    expect(first).toHaveLength(43);
    expect(isCodeChallenge(first)).toBe(true);
    expect(first).not.toBe(second);
  });
});

describe('isCodeChallenge', () => {
  it('accepts 43 to 128 unreserved characters', () => {
    expect(isCodeChallenge('a'.repeat(43))).toBe(true);
    expect(isCodeChallenge(`${'A1-._~'.repeat(21)}ab`)).toBe(true);
    expect(isCodeChallenge('a'.repeat(128))).toBe(true);
  });

  it('refuses a short, long, padded or empty value', () => {
    expect(isCodeChallenge('a'.repeat(42))).toBe(false);
    expect(isCodeChallenge('a'.repeat(129))).toBe(false);
    expect(isCodeChallenge(`${'a'.repeat(42)}=`)).toBe(false);
    expect(isCodeChallenge(`${'a'.repeat(42)}+`)).toBe(false);
    expect(isCodeChallenge('')).toBe(false);
  });
});
