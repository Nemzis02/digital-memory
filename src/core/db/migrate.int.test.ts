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
