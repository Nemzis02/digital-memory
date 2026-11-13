import { describe, expect, it } from 'vitest';
import { withTempDatabase } from '../../test/integration.ts';
import type { Database } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import { upsertUser } from '../db/users.ts';
import { createOAuthClients } from './clients.ts';
import type { TokenGrant } from './tokens.ts';
import { createOAuthTokens } from './tokens.ts';

const RESOURCE = 'https://memory.example/mcp';

async function grant(db: Database): Promise<TokenGrant> {
  await runMigrations(db);

  const client = await createOAuthClients(db).register({
    name: 'Cursor',
    redirectUris: ['https://cursor.example/callback'],
  });

  return {
    clientId: client.clientId,
    userId: await upsertUser(db, 123456789),
    scopes: ['memory:read', 'memory:write', 'memory:delete'],
    resource: RESOURCE,
  };
}

describe('oauth tokens', () => {
  it('issues a family and authenticates only a live access token', async () => {
    await withTempDatabase(async ({ db }) => {
      const issued = await grant(db);
      const tokens = createOAuthTokens(db, { accessTtlSeconds: 3600, refreshTtlSeconds: 86_400 });

      const first = await tokens.issue(issued);

      expect(first.expiresIn).toBe(3600);
      expect(first.scopes).toEqual(issued.scopes);

      expect(await tokens.authenticate(first.accessToken)).toEqual({
        clientId: issued.clientId,
        userId: issued.userId,
        scopes: issued.scopes,
        resource: RESOURCE,
      });

      expect(await tokens.authenticate(first.refreshToken)).toBeUndefined();
      expect(await tokens.authenticate('unknown')).toBeUndefined();
      const by = { clientId: issued.clientId };

      expect(await tokens.refresh(first.accessToken, by)).toEqual({ kind: 'rejected' });
      expect(await tokens.refresh('unknown', by)).toEqual({ kind: 'rejected' });

      expect(await tokens.refresh(first.refreshToken, { clientId: 'other' })).toEqual({
        kind: 'rejected',
      });
    });
  });

  it('rotates on refresh and revokes the family when a rotated token comes back', async () => {
    await withTempDatabase(async ({ db }) => {
      const issued = await grant(db);
      const tokens = createOAuthTokens(db, { accessTtlSeconds: 3600, refreshTtlSeconds: 86_400 });

      const by = { clientId: issued.clientId };
      const first = await tokens.issue(issued);

      expect(await tokens.refresh(first.refreshToken, { ...by, scopes: ['memory:admin'] })).toEqual(
        { kind: 'invalid_scope', granted: issued.scopes },
      );

      const rotated = await tokens.refresh(first.refreshToken, { ...by, scopes: ['memory:read'] });

      if (rotated.kind !== 'issued') {
        throw new Error(`expected issued, got ${rotated.kind}`);
      }

      expect(rotated.tokens.familyId).toBe(first.familyId);
      expect(rotated.tokens.scopes).toEqual(['memory:read']);
      expect(rotated.tokens.refreshToken).not.toBe(first.refreshToken);
      expect(await tokens.authenticate(first.accessToken)).toBeDefined();

      expect(await tokens.authenticate(rotated.tokens.accessToken)).toMatchObject({
        scopes: ['memory:read'],
      });

      expect(await tokens.refresh(first.refreshToken, by)).toEqual({
        kind: 'reused',
        familyId: first.familyId,
        userId: issued.userId,
      });

      expect(await tokens.authenticate(first.accessToken)).toBeUndefined();
      expect(await tokens.authenticate(rotated.tokens.accessToken)).toBeUndefined();
      expect(await tokens.refresh(rotated.tokens.refreshToken, by)).toEqual({ kind: 'rejected' });
    });
  });

  it('rejects an expired access or refresh token', async () => {
    await withTempDatabase(async ({ db }) => {
      const issued = await grant(db);
      let clock = new Date('2026-11-12T10:00:00Z');

      const tokens = createOAuthTokens(db, {
        accessTtlSeconds: 60,
        refreshTtlSeconds: 120,
        now: () => clock,
      });

      const first = await tokens.issue(issued);

      clock = new Date('2026-11-12T10:01:00Z');

      expect(await tokens.authenticate(first.accessToken)).toBeUndefined();
      const by = { clientId: issued.clientId };

      expect((await tokens.refresh(first.refreshToken, by)).kind).toBe('issued');

      clock = new Date('2026-11-12T10:03:00Z');

      expect(await tokens.refresh(first.refreshToken, by)).toEqual({ kind: 'rejected' });
    });
  });
});
