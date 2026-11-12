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
  LLM_FAST_API_KEY: 'llm-key',
} satisfies NodeJS.ProcessEnv;

describe('parseEnv', () => {
  it('applies defaults and coerces numeric values', () => {
    const env = parseEnv(valid);

    expect(env.NODE_ENV).toBe('development');
    expect(env.QDRANT_COLLECTION).toBe('digital_memory');
    expect(env.TELEGRAM_ADMIN_ID).toBe(123456789);
    expect(env.R2_PRESIGN_TTL_SECONDS).toBe(900);
    expect(env.LLM_STRONG_API_KEY).toBeUndefined();
    expect(env.OAUTH_ACCESS_TTL_SECONDS).toBe(3600);
    expect(env.OAUTH_REFRESH_TTL_SECONDS).toBe(2_592_000);
    expect(env.MCP_MAX_FILE_BYTES).toBe(10_485_760);
  });

  it('reads an optional variable left blank as absent', () => {
    const env = parseEnv({ ...valid, LLM_STRONG_API_KEY: '   ', PUBLIC_URL: '' });

    expect(env.LLM_STRONG_API_KEY).toBeUndefined();
    expect(env.PUBLIC_URL).toBeUndefined();
  });

  it('still reports a required variable left blank', () => {
    expect(() => parseEnv({ ...valid, LLM_FAST_API_KEY: '' })).toThrow(/LLM_FAST_API_KEY/);
  });

  it('rejects a pre-signed URL TTL above 15 minutes', () => {
    expect(() => parseEnv({ ...valid, R2_PRESIGN_TTL_SECONDS: '901' })).toThrow(
      /R2_PRESIGN_TTL_SECONDS/,
    );
  });

  it('reports every missing variable in a single error', () => {
    expect(() => parseEnv({})).toThrow(/TELEGRAM_BOT_TOKEN[\s\S]*LLM_FAST_API_KEY/);
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

    expect(() =>
      parseEnv({ ...valid, PUBLIC_URL: 'https://memory.example', TELEGRAM_WEBHOOK_SECRET: '' }),
    ).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
  });

  it('refuses a reachable issuer with no OIDC secret to finish a login', () => {
    const reachable = {
      ...valid,
      PUBLIC_URL: 'https://memory.example',
      TELEGRAM_WEBHOOK_SECRET: 'webhook-secret-of-16',
    };

    expect(() => parseEnv(reachable)).toThrow(/TELEGRAM_OIDC_CLIENT_SECRET/);

    expect(() => parseEnv({ ...reachable, TELEGRAM_OIDC_CLIENT_SECRET: '  ' })).toThrow(
      /TELEGRAM_OIDC_CLIENT_SECRET/,
    );

    expect(
      parseEnv({ ...reachable, TELEGRAM_OIDC_CLIENT_SECRET: 'oidc-secret' })
        .TELEGRAM_OIDC_CLIENT_SECRET,
    ).toBe('oidc-secret');
  });

  it('rejects a file cap or token lifetime that is not a positive integer', () => {
    expect(() => parseEnv({ ...valid, MCP_MAX_FILE_BYTES: '0' })).toThrow(/MCP_MAX_FILE_BYTES/);

    expect(() => parseEnv({ ...valid, OAUTH_ACCESS_TTL_SECONDS: '1.5' })).toThrow(
      /OAUTH_ACCESS_TTL_SECONDS/,
    );
  });

  it('allows long polling, where there is no endpoint to forge against', () => {
    expect(parseEnv(valid).PUBLIC_URL).toBeUndefined();
    expect(parseEnv(valid).PORT).toBe(8080);
  });

  it('leaves tracing off when no Langfuse key is set', () => {
    const env = parseEnv(valid);

    expect(env.LANGFUSE_PUBLIC_KEY).toBeUndefined();
    expect(env.LANGFUSE_SECRET_KEY).toBeUndefined();
    expect(env.LANGFUSE_BASE_URL).toBe('https://cloud.langfuse.com');
  });

  it('accepts both Langfuse keys and an explicit base URL', () => {
    const env = parseEnv({
      ...valid,
      LANGFUSE_PUBLIC_KEY: 'pk-test',
      LANGFUSE_SECRET_KEY: 'sk-test',
      LANGFUSE_BASE_URL: 'https://langfuse.example',
    });

    expect(env.LANGFUSE_PUBLIC_KEY).toBe('pk-test');
    expect(env.LANGFUSE_SECRET_KEY).toBe('sk-test');
    expect(env.LANGFUSE_BASE_URL).toBe('https://langfuse.example');
  });

  it('refuses one Langfuse key without the other', () => {
    expect(() => parseEnv({ ...valid, LANGFUSE_PUBLIC_KEY: 'pk-test' })).toThrow(
      /LANGFUSE_SECRET_KEY/,
    );

    expect(() => parseEnv({ ...valid, LANGFUSE_SECRET_KEY: 'sk-test' })).toThrow(
      /LANGFUSE_PUBLIC_KEY/,
    );

    expect(() =>
      parseEnv({ ...valid, LANGFUSE_PUBLIC_KEY: 'pk-test', LANGFUSE_SECRET_KEY: '  ' }),
    ).toThrow(/LANGFUSE_SECRET_KEY/);
  });

  it('rejects a malformed Langfuse base URL', () => {
    expect(() => parseEnv({ ...valid, LANGFUSE_BASE_URL: 'not-a-url' })).toThrow(
      /LANGFUSE_BASE_URL/,
    );
  });

  it('derives the R2 S3 endpoint from the account id', () => {
    expect(r2Endpoint(parseEnv(valid))).toBe('https://acct.r2.cloudflarestorage.com');
  });
});
