import { createHash } from 'node:crypto';
import { newSecret } from './secret.ts';

const CODE_CHALLENGE = /^[A-Za-z0-9._~-]{43,128}$/;

/** A PKCE verifier: 32 random bytes as base64url, 43 characters. */
export function newVerifier(): string {
  return newSecret();
}

/** The S256 challenge of a verifier: base64url of its SHA-256 (RFC 7636). */
export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** True for a verifier or an S256 challenge as the RFC bounds them: 43 to 128 unreserved characters. */
export function isCodeChallenge(value: string): boolean {
  return CODE_CHALLENGE.test(value);
}
