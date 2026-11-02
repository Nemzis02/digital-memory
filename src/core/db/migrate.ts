import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './client.ts';

// Resolved from this module so the folder is found from src/ and from dist/ alike.
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../drizzle', import.meta.url));

/** Applies every migration in `drizzle/` that the database has not recorded yet. */
export function runMigrations(db: Database): Promise<void> {
  return migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
