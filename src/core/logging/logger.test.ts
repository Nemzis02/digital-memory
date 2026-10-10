import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger.ts';
import { resetSecretsCache } from './redact.ts';

const SECRET = '123456789:AAHsuperSecretBotTokenValue';

describe('logger', () => {
  beforeEach(() => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', SECRET);
    vi.stubEnv('LOG_LEVEL', 'debug');
    resetSecretsCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetSecretsCache();
  });

  const capture = (stream: 'stdout' | 'stderr') =>
    vi.spyOn(process[stream], 'write').mockImplementation(() => true);

  const parse = (write: ReturnType<typeof capture>): Record<string, unknown> =>
    JSON.parse(String(write.mock.calls[0]?.[0])) as Record<string, unknown>;

  it('writes a structured record to stdout and redacts the fields', () => {
    const write = capture('stdout');

    logger.info('starting', { token: SECRET, chatId: 42 });

    expect(write).toHaveBeenCalledOnce();

    const record = parse(write);

    expect(record.level).toBe('info');
    expect(record.message).toBe('starting');
    expect(record.token).toBe('[REDACTED]');
    expect(record.chatId).toBe(42);
  });

  it('masks a secret embedded in the message itself', () => {
    const write = capture('stdout');

    logger.info(`calling getMe with ${SECRET}`);

    expect(parse(write).message).toBe('calling getMe with [REDACTED]');
  });

  it('routes warn and error to stderr', () => {
    const stderr = capture('stderr');
    const stdout = capture('stdout');

    logger.error('boom');
    logger.warn('careful');

    expect(stderr).toHaveBeenCalledTimes(2);
    expect(stdout).not.toHaveBeenCalled();
  });

  it('suppresses records below the configured level', () => {
    vi.stubEnv('LOG_LEVEL', 'warn');

    const write = capture('stdout');

    logger.info('should not appear');
    logger.debug('nor this');

    expect(write).not.toHaveBeenCalled();
  });

  it('falls back to info when LOG_LEVEL is absent or invalid', () => {
    vi.stubEnv('LOG_LEVEL', 'nonsense');

    const write = capture('stdout');

    logger.debug('below info');
    logger.info('at info');

    expect(write).toHaveBeenCalledOnce();
    expect(parse(write).message).toBe('at info');
  });

  it('merges child bindings into every record', () => {
    const write = capture('stdout');

    logger.child({ module: 'ingestion' }).info('processing', { messageId: 7 });

    const record = parse(write);

    expect(record.module).toBe('ingestion');
    expect(record.messageId).toBe(7);
  });
});
