import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Env } from '../../config/env.ts';
import { getEnv } from '../../config/env.ts';
import { logger } from '../logging/logger.ts';
import * as schema from './schema.ts';

const log = logger.child({ module: 'db/client' });

export type Database = NodePgDatabase<typeof schema>;

export function createPool(env: Env = getEnv()): pg.Pool {
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  pool.on('error', (error) => {
    log.error('idle client error', { error });
  });

  return pool;
}

let sharedPool: pg.Pool | undefined;

export function pool(): pg.Pool {
  sharedPool ??= createPool();

  return sharedPool;
}

let sharedDatabase: Database | undefined;

export function database(): Database {
  sharedDatabase ??= drizzle(pool(), { schema });

  return sharedDatabase;
}

export async function closeDatabase(): Promise<void> {
  const open = sharedPool;

  sharedPool = undefined;
  sharedDatabase = undefined;

  await open?.end();
}
