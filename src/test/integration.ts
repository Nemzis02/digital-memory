import { randomBytes } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Env } from '../config/env.ts';
import { parseEnv } from '../config/env.ts';
import type { Database } from '../core/db/client.ts';
import * as schema from '../core/db/schema.ts';
import { createQdrantClient } from '../core/vector/qdrant.ts';

// Only the store settings come from the environment; the rest never leaves the process.
const PLACEHOLDERS: Record<string, string> = {
  TELEGRAM_BOT_TOKEN: '123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', // gitleaks:allow
  TELEGRAM_ADMIN_ID: '123456789',
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'access',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET_NAME: 'digital-memory',
  LLM_FAST_API_KEY: 'llm-key',
};

const STORE_KEYS = ['DATABASE_URL', 'QDRANT_URL', 'QDRANT_API_KEY', 'QDRANT_COLLECTION'] as const;

export function integrationEnv(overrides: Partial<Env> = {}): Env {
  const source: Record<string, string> = { ...PLACEHOLDERS };

  for (const key of STORE_KEYS) {
    const value = process.env[key];

    if (value !== undefined) {
      source[key] = value;
    }
  }

  return { ...parseEnv(source), ...overrides };
}

const token = (): string => randomBytes(6).toString('hex');

export interface TempDatabase {
  db: Database;
  pool: pg.Pool;
}

/** A database created for one test run on the configured server and dropped afterwards. */
export async function withTempDatabase<T>(run: (temp: TempDatabase) => Promise<T>): Promise<T> {
  const env = integrationEnv();
  const name = `dm_int_${token()}`;
  const admin = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 });

  try {
    await admin.query(`CREATE DATABASE "${name}"`);

    const url = new URL(env.DATABASE_URL);

    url.pathname = `/${name}`;

    const pool = new pg.Pool({ connectionString: url.href, max: 4 });

    try {
      return await run({ db: drizzle(pool, { schema }), pool });
    } finally {
      await pool.end();
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    }
  } finally {
    await admin.end();
  }
}

/** An `Env` whose Qdrant collection exists for one test run only. */
export async function withTempCollection<T>(run: (env: Env) => Promise<T>): Promise<T> {
  const env = integrationEnv({ QDRANT_COLLECTION: `int_${token()}` });

  try {
    return await run(env);
  } finally {
    await createQdrantClient(env).deleteCollection(env.QDRANT_COLLECTION);
  }
}
