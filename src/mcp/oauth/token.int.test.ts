import { describe, expect, it } from 'vitest';
import { runMigrations } from '../../core/db/migrate.ts';
import { upsertUser } from '../../core/db/users.ts';
import { createOAuthClients } from '../../core/oauth/clients.ts';
import { createAuthorizationCodes } from '../../core/oauth/codes.ts';
import { challengeFor } from '../../core/oauth/pkce.ts';
import { createOAuthTokens } from '../../core/oauth/tokens.ts';
import { withTempDatabase } from '../../test/integration.ts';
import { ORIGIN, serving, VERIFIER } from './fixtures.ts';
import { tokenRoute } from './token.ts';

const RESOURCE = `${ORIGIN}/mcp`;

const CALLBACK = 'https://cursor.example/callback';

const SCOPES = ['memory:read', 'memory:write'];

interface TokenBody {
  access_token: string;
  refresh_token: string;
  scope: string;
  error?: string;
}

describe('POST /oauth/token against Postgres', () => {
  it('exchanges a code once, rotates the pair and revokes the family on reuse', async () => {
    await withTempDatabase(async ({ db }) => {
      await runMigrations(db);

      const client = await createOAuthClients(db).register({
        name: 'Cursor',
        redirectUris: [CALLBACK],
      });

      const userId = await upsertUser(db, 123456789);
      const codes = createAuthorizationCodes(db);
      const tokens = createOAuthTokens(db, { accessTtlSeconds: 3600, refreshTtlSeconds: 86_400 });
      const server = await serving([tokenRoute({ origin: ORIGIN, codes, tokens })]);

      const post = async (body: Record<string, string>) => {
        const response = await fetch(`${server.base}/oauth/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(body).toString(),
        });

        return { status: response.status, body: (await response.json()) as TokenBody };
      };

      try {
        const code = await codes.mint({
          clientId: client.clientId,
          userId,
          redirectUri: CALLBACK,
          codeChallenge: challengeFor(VERIFIER),
          scopes: SCOPES,
          resource: RESOURCE,
          expiresAt: new Date(Date.now() + 600_000),
        });

        const grant = {
          grant_type: 'authorization_code',
          code,
          client_id: client.clientId,
          redirect_uri: CALLBACK,
          code_verifier: VERIFIER,
          resource: RESOURCE,
        };

        const first = await post(grant);

        expect(first.status).toBe(200);

        expect(first.body).toMatchObject({
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'memory:read memory:write',
        });

        expect(await tokens.authenticate(first.body.access_token)).toEqual({
          clientId: client.clientId,
          userId,
          scopes: SCOPES,
          resource: RESOURCE,
        });

        expect((await post(grant)).body.error).toBe('invalid_grant');

        const refresh = (overrides: Record<string, string> = {}) =>
          post({
            grant_type: 'refresh_token',
            refresh_token: first.body.refresh_token,
            client_id: client.clientId,
            ...overrides,
          });

        expect((await refresh({ client_id: 'other' })).body.error).toBe('invalid_grant');
        expect((await refresh({ scope: 'memory:delete' })).body.error).toBe('invalid_scope');

        const second = await refresh({ scope: 'memory:read' });

        expect(second.status).toBe(200);
        expect(second.body.scope).toBe('memory:read');
        expect(second.body.refresh_token).not.toBe(first.body.refresh_token);

        expect(await tokens.authenticate(second.body.access_token)).toMatchObject({
          scopes: ['memory:read'],
        });

        const reuse = await refresh();

        expect(reuse.status).toBe(400);
        expect(reuse.body.error).toBe('invalid_grant');
        expect(await tokens.authenticate(first.body.access_token)).toBeUndefined();
        expect(await tokens.authenticate(second.body.access_token)).toBeUndefined();
      } finally {
        await server.close();
      }
    });
  });
});
