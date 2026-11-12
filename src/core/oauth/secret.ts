import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes as base64url: a code or a token that only ever travels to the client. */
export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** The SHA-256 hex digest that the stores keep instead of the secret. */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}
