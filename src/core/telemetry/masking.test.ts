import { SpanStatusCode } from '@opentelemetry/api';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REDACTED, resetSecretsCache } from '../logging/redact.ts';
import { maskSpan } from './masking.ts';

const TOKEN = '123456789:AAHsuperSecretBotTokenValue';

function span(): ReadableSpan {
  return {
    attributes: {
      'gen_ai.input.messages': JSON.stringify([{ role: 'user', content: `token ${TOKEN}` }]),
      'ai.response.text': [`echo ${TOKEN}`, 'plain'],
      'gen_ai.usage.input_tokens': 3,
      'ai.usage.inputTokens': 3,
    },
    events: [{ name: 'exception', time: [0, 0], attributes: { 'exception.message': TOKEN } }],
    status: { code: SpanStatusCode.ERROR, message: `failed with ${TOKEN}` },
  } as unknown as ReadableSpan;
}

describe('maskSpan', () => {
  beforeEach(() => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', TOKEN);
    resetSecretsCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetSecretsCache();
  });

  it('masks a secret in attributes, string arrays, events and the status message', () => {
    const masked = span();

    maskSpan(masked);

    expect(JSON.stringify(masked)).not.toContain(TOKEN);

    expect(masked.attributes['gen_ai.input.messages']).toContain(`token ${REDACTED}`);
    expect(masked.attributes['ai.response.text']).toStrictEqual([`echo ${REDACTED}`, 'plain']);
    expect(masked.events[0]?.attributes?.['exception.message']).toBe(REDACTED);
    expect(masked.status.message).toBe(`failed with ${REDACTED}`);
  });

  it('keeps the token counts that share a name with a sensitive field', () => {
    const masked = span();

    maskSpan(masked);

    expect(masked.attributes['gen_ai.usage.input_tokens']).toBe(3);
    expect(masked.attributes['ai.usage.inputTokens']).toBe(3);
  });
});
