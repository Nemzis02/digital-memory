import { describe, expect, it } from 'vitest';
import { withTempDatabase } from '../../test/integration.ts';
import { runMigrations } from '../db/migrate.ts';
import { upsertUser } from '../db/users.ts';
import { createOAuthClients } from './clients.ts';
import { createAuthorizationCodes } from './codes.ts';

describe('authorization codes', () => {
  it('consumes a code once and returns what it was issued for', async () => {
    await withTempDatabase(async ({ db }) => {
      await runMigrations(db);

      const client = await createOAuthClients(db).register({
        name: 'Cursor',
        redirectUris: ['https://cursor.example/callback'],
      });

      const userId = await upsertUser(db, 123456789);
      const codes = createAuthorizationCodes(db);
      const expiresAt = new Date(Date.now() + 600_000);

      const code = await codes.mint({
        clientId: client.clientId,
        userId,
        redirectUri: 'https://cursor.example/callback',
        codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        scopes: ['memory:read', 'memory:write'],
        resource: 'https://memory.example/mcp',
        expiresAt,
      });

      expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(await codes.consume('unknown')).toBeUndefined();

      expect(await codes.consume(code)).toEqual({
        clientId: client.clientId,
        userId,
        redirectUri: 'https://cursor.example/callback',
        codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        codeChallengeMethod: 'S256',
        scopes: ['memory:read', 'memory:write'],
        resource: 'https://memory.example/mcp',
        expiresAt,
      });

      expect(await codes.consume(code)).toBeUndefined();
    });
  });
});
