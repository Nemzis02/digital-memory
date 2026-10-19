const SECRET_ENV_KEYS = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'DATABASE_URL',
  'QDRANT_API_KEY',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'LLM_FAST_API_KEY',
  'LLM_STRONG_API_KEY',
] as const;

const SENSITIVE_FIELD = /(token|secret|password|api[-_]?key|authorization|cookie|credential)/i;

export const REDACTED = '[REDACTED]';

const MIN_MASKABLE_LENGTH = 8;

let secretsCache: string[] | undefined;

function secretValues(): string[] {
  if (secretsCache === undefined) {
    secretsCache = SECRET_ENV_KEYS.map((key) => process.env[key]).filter(
      (value): value is string => typeof value === 'string' && value.length >= MIN_MASKABLE_LENGTH,
    );
  }

  return secretsCache;
}

export function resetSecretsCache(): void {
  secretsCache = undefined;
}

export function maskSecrets(text: string): string {
  let masked = text;

  for (const secret of secretValues()) {
    masked = masked.replaceAll(secret, REDACTED);
  }

  return masked;
}

function redact(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return maskSecrets(value);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: maskSecrets(value.message),
      stack: value.stack === undefined ? undefined : maskSecrets(value.stack),
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, seen));
  }

  const result: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(value)) {
    result[key] = SENSITIVE_FIELD.test(key) ? REDACTED : redact(nested, seen);
  }

  return result;
}

export function redactValue(value: unknown): unknown {
  return redact(value, new WeakSet());
}
