import { z } from 'zod';

const nonEmpty = (label: string) =>
  z
    .string({ error: (issue) => (issue.input === undefined ? `${label} is required` : undefined) })
    .trim()
    .min(1, `${label} must not be empty`);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Telegram
  TELEGRAM_BOT_TOKEN: nonEmpty('TELEGRAM_BOT_TOKEN').regex(
    /^\d+:[A-Za-z0-9_-]{30,}$/,
    'TELEGRAM_BOT_TOKEN must look like "<bot_id>:<secret>"',
  ),
  TELEGRAM_ADMIN_ID: z.coerce
    .number()
    .int()
    .positive('TELEGRAM_ADMIN_ID must be a positive Telegram user ID'),

  // Qdrant Cloud
  QDRANT_URL: z.url('QDRANT_URL must be a valid URL'),
  QDRANT_API_KEY: nonEmpty('QDRANT_API_KEY'),
  QDRANT_COLLECTION: nonEmpty('QDRANT_COLLECTION').default('digital_memory'),

  // Cloudflare R2 (S3-compatible)
  R2_ACCOUNT_ID: nonEmpty('R2_ACCOUNT_ID'),
  R2_ACCESS_KEY_ID: nonEmpty('R2_ACCESS_KEY_ID'),
  R2_SECRET_ACCESS_KEY: nonEmpty('R2_SECRET_ACCESS_KEY'),
  R2_BUCKET_NAME: nonEmpty('R2_BUCKET_NAME'),
  // Hard ceiling, not a tunable: R2 objects must never be reachable for longer.
  R2_PRESIGN_TTL_SECONDS: z.coerce.number().int().positive().max(900).default(900),

  // LLM routing
  LLM_API_KEY: nonEmpty('LLM_API_KEY'),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }

  return result.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached === undefined) {
    cached = parseEnv();
  }

  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}

export const r2Endpoint = (env: Env): string =>
  `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
