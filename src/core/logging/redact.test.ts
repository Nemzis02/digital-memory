import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { maskSecrets, redactValue, resetSecretsCache } from './redact.ts';

const SECRET = '123456789:AAHsuperSecretBotTokenValue';

describe('redact', () => {
  beforeEach(() => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', SECRET);
    resetSecretsCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetSecretsCache();
  });

  it('masks a known secret wherever it appears in a string', () => {
    expect(maskSecrets(`calling https://api.telegram.org/bot${SECRET}/getMe`)).toBe(
      'calling https://api.telegram.org/bot[REDACTED]/getMe',
    );
  });

  it('leaves text without secrets untouched', () => {
    expect(maskSecrets('nothing sensitive here')).toBe('nothing sensitive here');
  });

  it('redacts by field name even when the value is unknown', () => {
    expect(
      redactValue({ r2_secret_access_key: 'never-seen-before', bucket: 'digital-memory' }),
    ).toEqual({ r2_secret_access_key: '[REDACTED]', bucket: 'digital-memory' });
  });

  it('walks nested objects and arrays', () => {
    expect(redactValue({ items: [{ note: `token ${SECRET}` }] })).toEqual({
      items: [{ note: 'token [REDACTED]' }],
    });
  });

  it('masks secrets inside error messages', () => {
    const result = redactValue(new Error(`request failed for ${SECRET}`)) as { message: string };

    expect(result.message).toBe('request failed for [REDACTED]');
  });

  it('passes through primitives unchanged', () => {
    expect(redactValue(42)).toBe(42);
    expect(redactValue(null)).toBeNull();
    expect(redactValue(true)).toBe(true);
  });

  it('survives circular references', () => {
    const node: Record<string, unknown> = { name: 'root' };
    node.self = node;

    expect(redactValue(node)).toEqual({ name: 'root', self: '[Circular]' });
  });

  it('ignores secrets too short to mask safely', () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'abc');
    resetSecretsCache();

    expect(maskSecrets('abc is a common substring')).toBe('abc is a common substring');
  });
});
