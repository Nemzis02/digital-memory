import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTempDatabase } from '../../test/integration.ts';
import type { Database } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import type { LoginSessionInput } from './login-sessions.ts';
import { createLoginSessions } from './login-sessions.ts';

const input = (expiresAt: Date): LoginSessionInput => ({
  request: {
    clientId: 'https://client.example/oauth/client.json',
    redirectUri: 'https://claude.ai/api/mcp/auth_callback',
    codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    scopes: ['memory:read'],
    resource: 'https://memory.example/mcp',
    state: 'client-state',
  },
  state: 'provider-state',
  nonce: 'provider-nonce',
  codeVerifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  expiresAt,
});

async function userCount(db: Database): Promise<number> {
  const result = await db.execute<{ count: string }>(
    sql`SELECT count(*)::text AS count FROM users`,
  );

  return Number(result.rows[0]?.count);
}

describe('login sessions', () => {
  it('binds a user to a live session and hands the session out once', async () => {
    await withTempDatabase(async ({ db }) => {
      await runMigrations(db);

      const sessions = createLoginSessions(db);
      const started = input(new Date(Date.now() + 600_000));
      const id = await sessions.start(started);

      expect(await sessions.find(id)).toEqual({ id, ...started });

      const once = await sessions.login(id, { telegramId: 123456789, displayName: 'Kirill' });
      const twice = await sessions.login(id, { telegramId: 123456789 });

      expect(once?.userId).toBeDefined();
      expect(twice?.userId).toBe(once?.userId);
      expect(await userCount(db)).toBe(1);

      expect(await sessions.consume(id)).toEqual({ id, ...started, userId: once?.userId });
      expect(await sessions.consume(id)).toBeUndefined();
      expect(await sessions.find(id)).toBeUndefined();
      expect(await sessions.login(id, { telegramId: 123456789 })).toBeUndefined();
    });
  });

  it('treats an expired session as gone and discards a refused one', async () => {
    await withTempDatabase(async ({ db }) => {
      await runMigrations(db);

      const sessions = createLoginSessions(db);
      const expired = await sessions.start(input(new Date(Date.now() - 1000)));

      expect(await sessions.find(expired)).toBeUndefined();
      expect(await sessions.login(expired, { telegramId: 123456789 })).toBeUndefined();
      expect(await sessions.consume(expired)).toBeUndefined();

      const refused = await sessions.start(input(new Date(Date.now() + 600_000)));

      await sessions.discard(refused);

      expect(await sessions.find(refused)).toBeUndefined();
    });
  });
});
