import { closeDatabase, database } from './client.ts';
import { runMigrations } from './migrate.ts';

try {
  await runMigrations(database());

  console.log('migrations applied');
} finally {
  await closeDatabase();
}
