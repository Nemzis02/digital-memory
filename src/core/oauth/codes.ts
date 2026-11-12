import type { UUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { database } from '../db/client.ts';
import { oauthAuthorizationCodes } from '../db/schema.ts';
import { hashSecret, newSecret } from './secret.ts';

export interface CodeGrant {
  clientId: string;
  userId: UUID;
  redirectUri: string;
  codeChallenge: string;
  scopes: readonly string[];
  resource: string;
  expiresAt: Date;
}

export interface AuthorizationCode extends Omit<CodeGrant, 'scopes'> {
  scopes: string[];
  codeChallengeMethod: string;
}

export interface AuthorizationCodes {
  /** Stores the hash and returns the raw code once. The challenge method is always S256. */
  mint(grant: CodeGrant): Promise<string>;
  /**
   * Marks the code used and returns what it was issued for, once. The caller still checks the
   * client, redirect URI, verifier, expiry and resource: a code that fails any of them stays burnt.
   */
  consume(code: string): Promise<AuthorizationCode | undefined>;
}

export function createAuthorizationCodes(db: Database = database()): AuthorizationCodes {
  return {
    async mint(grant) {
      const code = newSecret();

      await db.insert(oauthAuthorizationCodes).values({
        codeHash: hashSecret(code),
        clientId: grant.clientId,
        userId: grant.userId,
        redirectUri: grant.redirectUri,
        codeChallenge: grant.codeChallenge,
        codeChallengeMethod: 'S256',
        scope: grant.scopes.join(' '),
        resource: grant.resource,
        expiresAt: grant.expiresAt,
      });

      return code;
    },

    async consume(code) {
      const [row] = await db
        .update(oauthAuthorizationCodes)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(oauthAuthorizationCodes.codeHash, hashSecret(code)),
            isNull(oauthAuthorizationCodes.consumedAt),
          ),
        )
        .returning();

      if (row === undefined) {
        return undefined;
      }

      return {
        clientId: row.clientId,
        userId: row.userId as UUID,
        redirectUri: row.redirectUri,
        codeChallenge: row.codeChallenge,
        codeChallengeMethod: row.codeChallengeMethod,
        scopes: row.scope.split(' '),
        resource: row.resource,
        expiresAt: row.expiresAt,
      };
    },
  };
}
