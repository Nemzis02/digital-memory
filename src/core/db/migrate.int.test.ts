import { readMigrationFiles } from 'drizzle-orm/migrator';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTempDatabase } from '../../test/integration.ts';
import { MIGRATIONS_FOLDER, runMigrations } from './migrate.ts';

describe('runMigrations', () => {
  it('builds the schema on an empty database and is a no-op the second time', async () => {
    await withTempDatabase(async ({ db }) => {
      await runMigrations(db);

      const tables = await db.execute<{ table_name: string }>(
        sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
      );

      const names = tables.rows.map((row) => row.table_name);

      expect(names).toEqual(
        expect.arrayContaining([
          'users',
          'conversations',
          'conversation_turns',
          'oauth_clients',
          'oauth_authorization_codes',
          'oauth_tokens',
          'oauth_login_sessions',
          'forget_requests',
        ]),
      );

      const columns = await db.execute<{ column: string }>(
        sql`SELECT table_name || '.' || column_name AS column
            FROM information_schema.columns WHERE table_schema = 'public'`,
      );

      expect(columns.rows.map((row) => row.column)).toEqual(
        expect.arrayContaining([
          'oauth_clients.kind',
          'oauth_clients.metadata_url',
          'oauth_clients.fetched_at',
          'oauth_clients.etag',
          'oauth_authorization_codes.resource',
          'oauth_tokens.resource',
          'oauth_tokens.family_id',
          'oauth_login_sessions.request',
          'oauth_login_sessions.state',
          'oauth_login_sessions.nonce',
          'oauth_login_sessions.code_verifier',
          'oauth_login_sessions.user_id',
          'oauth_login_sessions.expires_at',
          'oauth_login_sessions.consumed_at',
          'forget_requests.user_id',
          'forget_requests.client_id',
          'forget_requests.expires_at',
        ]),
      );

      await runMigrations(db);

      const applied = await db.execute<{ count: string }>(
        sql`SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`,
      );

      expect(Number(applied.rows[0]?.count)).toBe(
        readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }).length,
      );
    });
  });
});
