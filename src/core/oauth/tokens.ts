import type { UUID } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { database } from '../db/client.ts';
import { oauthTokens } from '../db/schema.ts';
import { hashSecret, newSecret } from './secret.ts';

export interface TokenGrant {
  clientId: string;
  userId: UUID;
  scopes: readonly string[];
  resource: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  /** Access token lifetime in seconds, as the token response reports it. */
  expiresIn: number;
  scopes: string[];
  familyId: UUID;
}

export type RefreshOutcome =
  | { kind: 'issued'; tokens: IssuedTokens }
  /** A rotated refresh token came back, and this call revoked the rest of its family. */
  | { kind: 'reused'; familyId: UUID }
  /** Unknown, expired, not a refresh token, or from a family already revoked. */
  | { kind: 'rejected' };

export interface AccessGrant {
  clientId: string;
  userId: UUID;
  scopes: string[];
  resource: string;
}

export interface OAuthTokensOptions {
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  now?: () => Date;
}

export interface OAuthTokens {
  /** A new family with one access and one refresh token. */
  issue(grant: TokenGrant): Promise<IssuedTokens>;
  /**
   * Revokes the presented refresh token and issues a new pair in its family. `scopes` must be
   * a subset of the token's scopes; the caller answers `invalid_scope` before getting here.
   */
  refresh(refreshToken: string, scopes?: readonly string[]): Promise<RefreshOutcome>;
  /** The grant behind a live access token: type access, not revoked, not expired. */
  authenticate(accessToken: string): Promise<AccessGrant | undefined>;
}

export function createOAuthTokens(
  db: Database = database(),
  options: OAuthTokensOptions,
): OAuthTokens {
  const now = options.now ?? (() => new Date());

  const pair = (grant: TokenGrant & { familyId: UUID }, issuedAt: Date) => {
    const tokens: IssuedTokens = {
      accessToken: newSecret(),
      refreshToken: newSecret(),
      expiresIn: options.accessTtlSeconds,
      scopes: [...grant.scopes],
      familyId: grant.familyId,
    };

    const shared = {
      clientId: grant.clientId,
      userId: grant.userId,
      scope: tokens.scopes.join(' '),
      resource: grant.resource,
      familyId: grant.familyId,
      createdAt: issuedAt,
    };

    const rows = [
      {
        ...shared,
        tokenHash: hashSecret(tokens.accessToken),
        type: 'access' as const,
        expiresAt: new Date(issuedAt.getTime() + options.accessTtlSeconds * 1000),
      },
      {
        ...shared,
        tokenHash: hashSecret(tokens.refreshToken),
        type: 'refresh' as const,
        expiresAt: new Date(issuedAt.getTime() + options.refreshTtlSeconds * 1000),
      },
    ];

    return { tokens, rows };
  };

  return {
    async issue(grant) {
      const { tokens, rows } = pair({ ...grant, familyId: randomUUID() }, now());

      await db.insert(oauthTokens).values(rows);

      return tokens;
    },

    async refresh(refreshToken, scopes) {
      const at = now();
      const tokenHash = hashSecret(refreshToken);

      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(oauthTokens)
          .where(eq(oauthTokens.tokenHash, tokenHash));

        if (row === undefined || row.type !== 'refresh' || row.expiresAt <= at) {
          return { kind: 'rejected' };
        }

        const familyId = row.familyId as UUID;

        const revokeFamily = async (): Promise<RefreshOutcome> => {
          const swept = await tx
            .update(oauthTokens)
            .set({ revokedAt: at })
            .where(and(eq(oauthTokens.familyId, familyId), isNull(oauthTokens.revokedAt)))
            .returning({ tokenHash: oauthTokens.tokenHash });

          return swept.length === 0 ? { kind: 'rejected' } : { kind: 'reused', familyId };
        };

        if (row.revokedAt !== null) {
          return revokeFamily();
        }

        // A concurrent refresh of the same token wins the race here; the loser is a reuse.
        const revoked = await tx
          .update(oauthTokens)
          .set({ revokedAt: at })
          .where(and(eq(oauthTokens.tokenHash, tokenHash), isNull(oauthTokens.revokedAt)))
          .returning({ tokenHash: oauthTokens.tokenHash });

        if (revoked.length === 0) {
          return revokeFamily();
        }

        const granted = row.scope.split(' ');

        if (scopes !== undefined && scopes.some((scope) => !granted.includes(scope))) {
          throw new Error('A refresh may only narrow the scopes of the token it rotates');
        }

        const { tokens, rows } = pair(
          {
            clientId: row.clientId,
            userId: row.userId as UUID,
            scopes: scopes ?? granted,
            resource: row.resource,
            familyId,
          },
          at,
        );

        await tx.insert(oauthTokens).values(rows);

        return { kind: 'issued', tokens };
      });
    },

    async authenticate(accessToken) {
      const [row] = await db
        .select()
        .from(oauthTokens)
        .where(eq(oauthTokens.tokenHash, hashSecret(accessToken)));

      if (
        row === undefined ||
        row.type !== 'access' ||
        row.revokedAt !== null ||
        row.expiresAt <= now()
      ) {
        return undefined;
      }

      return {
        clientId: row.clientId,
        userId: row.userId as UUID,
        scopes: row.scope.split(' '),
        resource: row.resource,
      };
    },
  };
}
