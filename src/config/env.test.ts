import { describe, expect, it } from 'vitest';
import { parseEnv, r2Endpoint } from './env.ts';

const valid = {
  TELEGRAM_BOT_TOKEN: '123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', // gitleaks:allow
  TELEGRAM_ADMIN_ID: '123456789',
  DATABASE_URL: 'postgresql://digital_memory:pw@localhost:5432/digital_memory',
  QDRANT_URL: 'https://example.cloud.qdrant.io:6333',
  QDRANT_API_KEY: 'qdrant-key',
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'access',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET_NAME: 'digital-memory',
  LLM_API_KEY: 'llm-key',
} satisfies NodeJS.ProcessEnv;

describe('parseEnv', () => {
  it('applies defaults and coerces numeric values', () => {
    const env = parseEnv(valid);

    expect(env.NODE_ENV).toBe('development');
    expect(env.QDRANT_COLLECTION).toBe('digital_memory');
    expect(env.TELEGRAM_ADMIN_ID).toBe(123456789);
    expect(env.R2_PRESIGN_TTL_SECONDS).toBe(900);
  });

  it('rejects a pre-signed URL TTL above 15 minutes', () => {
    expect(() => parseEnv({ ...valid, R2_PRESIGN_TTL_SECONDS: '901' })).toThrow(
      /R2_PRESIGN_TTL_SECONDS/,
    );
  });

  it('reports every missing variable in a single error', () => {
    expect(() => parseEnv({})).toThrow(/TELEGRAM_BOT_TOKEN[\s\S]*LLM_API_KEY/);
  });

  it('rejects a malformed bot token', () => {
    expect(() => parseEnv({ ...valid, TELEGRAM_BOT_TOKEN: 'not-a-token' })).toThrow(
      /TELEGRAM_BOT_TOKEN/,
    );
  });

  it('refuses a reachable webhook with no secret to authenticate it', () => {
    expect(() => parseEnv({ ...valid, PUBLIC_URL: 'https://memory.example' })).toThrow(
      /TELEGRAM_WEBHOOK_SECRET/,
    );
  });

  it('allows long polling, where there is no endpoint to forge against', () => {
    expect(parseEnv(valid).PUBLIC_URL).toBeUndefined();
    expect(parseEnv(valid).PORT).toBe(8080);
  });

  it('derives the R2 S3 endpoint from the account id', () => {
    expect(r2Endpoint(parseEnv(valid))).toBe('https://acct.r2.cloudflarestorage.com');
  });
});
