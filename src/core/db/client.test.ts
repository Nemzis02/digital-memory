import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnv, resetEnvCache } from '../../config/env.ts';
import { closeDatabase, createPool, database, ping, pool } from './client.ts';
import { oauthAuthorizationCodes, oauthTokens, users } from './schema.ts';

const { poolConfigs, endMock, queryMock, handlers } = vi.hoisted(() => ({
  poolConfigs: [] as Record<string, unknown>[],
  endMock: vi.fn<() => Promise<void>>(),
  queryMock: vi.fn<(text: string) => Promise<unknown>>(),
  handlers: new Map<string, (error: Error) => void>(),
}));

vi.mock('pg', () => ({
  default: {
    Pool: class {
      end = endMock;
      query = queryMock;

      constructor(config: Record<string, unknown>) {
        poolConfigs.push(config);
      }

      on(event: string, handler: (error: Error) => void): void {
        handlers.set(event, handler);
      }
    },
  },
}));

const RAW: Record<string, string> = {
  TELEGRAM_BOT_TOKEN: '123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', // gitleaks:allow
  TELEGRAM_ADMIN_ID: '123456789',
  DATABASE_URL: 'postgresql://digital_memory:pw@localhost:5432/digital_memory',
  QDRANT_URL: 'https://example.cloud.qdrant.io:6333',
  QDRANT_API_KEY: 'qdrant-key',
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'access',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET_NAME: 'digital-memory',
  LLM_FAST_API_KEY: 'llm-key',
};

const env = parseEnv(RAW);

function withProcessEnv(): void {
  for (const [key, value] of Object.entries(RAW)) {
    vi.stubEnv(key, value);
  }

  resetEnvCache();
}

describe('createPool', () => {
  beforeEach(() => {
    poolConfigs.length = 0;
    handlers.clear();
    endMock.mockReset().mockResolvedValue();
    queryMock.mockReset().mockResolvedValue({ rows: [{ '?column?': 1 }] });
  });

  afterEach(async () => {
    await closeDatabase();
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it('connects with the configured URL and a bounded pool', () => {
    createPool(env);

    expect(poolConfigs[0]).toMatchObject({
      connectionString: env.DATABASE_URL,
      max: 10,
    });
  });

  it('handles idle client errors, which would otherwise crash the process', () => {
    createPool(env);

    expect(() => handlers.get('error')?.(new Error('connection terminated'))).not.toThrow();
  });

  it('hands the checkpointer and drizzle the same pool', () => {
    withProcessEnv();

    expect(pool()).toBe(pool());
    expect(database()).toBe(database());
    expect(poolConfigs).toHaveLength(1);
  });

  it('releases connections and forgets the cached pool', async () => {
    withProcessEnv();

    const first = pool();

    await closeDatabase();

    expect(endMock).toHaveBeenCalledOnce();
    expect(pool()).not.toBe(first);
  });
});

describe('ping', () => {
  afterEach(async () => {
    await closeDatabase();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    resetEnvCache();
  });

  it('runs a trivial query against the shared pool', async () => {
    withProcessEnv();
    queryMock.mockResolvedValue({ rows: [] });

    await expect(ping()).resolves.toBeUndefined();
    expect(queryMock).toHaveBeenCalledWith('SELECT 1');
  });

  it('gives up when the query hangs past the deadline', async () => {
    vi.useFakeTimers();
    queryMock.mockReturnValue(new Promise(() => {}));

    const outcome = expect(ping(createPool(env), 50)).rejects.toThrow('postgres');

    await vi.advanceTimersByTimeAsync(50);
    await outcome;
  });
});

describe('schema', () => {
  it('stores hashes rather than the credentials themselves', () => {
    expect(Object.keys(oauthAuthorizationCodes)).toContain('codeHash');
    expect(Object.keys(oauthTokens)).toContain('tokenHash');
    expect(Object.keys(oauthTokens)).not.toContain('token');
  });

  it('keys a user by their Telegram id', () => {
    expect(users.telegramId.notNull).toBe(true);
    expect(users.telegramId.isUnique).toBe(true);
  });
});
