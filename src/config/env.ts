import { z } from 'zod';

const nonEmpty = (label: string) =>
  z
    .string({ error: (issue) => (issue.input === undefined ? `${label} is required` : undefined) })
    .trim()
    .min(1, `${label} must not be empty`);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

    // One process serves the Telegram webhook, the MCP SSE endpoint, and the OAuth routes.
    PORT: z.coerce.number().int().positive().max(65535).default(8080),
    // Absent means long polling; present means the bot is reachable and must be authenticated.
    PUBLIC_URL: z.url('PUBLIC_URL must be a valid URL').optional(),
    TELEGRAM_WEBHOOK_SECRET: z
      .string()
      .regex(
        /^[A-Za-z0-9_-]{16,256}$/,
        'TELEGRAM_WEBHOOK_SECRET must be 16-256 characters of A-Z, a-z, 0-9, _ or -',
      )
      .optional(),

    // Telegram
    TELEGRAM_BOT_TOKEN: nonEmpty('TELEGRAM_BOT_TOKEN').regex(
      /^\d+:[A-Za-z0-9_-]{30,}$/,
      'TELEGRAM_BOT_TOKEN must look like "<bot_id>:<secret>"',
    ),
    TELEGRAM_ADMIN_ID: z.coerce
      .number()
      .int()
      .positive('TELEGRAM_ADMIN_ID must be a positive Telegram user ID'),

    // PostgreSQL: LangGraph checkpoints, OAuth2 state, user metadata
    DATABASE_URL: z
      .url('DATABASE_URL must be a valid connection URL')
      .refine(
        (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
        'DATABASE_URL must be a postgres:// connection string',
      ),

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
  })
  .refine((env) => env.PUBLIC_URL === undefined || env.TELEGRAM_WEBHOOK_SECRET !== undefined, {
    error:
      'TELEGRAM_WEBHOOK_SECRET is required once PUBLIC_URL is set: the secret header is all that separates a real Telegram update from a forged POST, and the admin guard cannot help because a forged update can claim any from.id',
    path: ['TELEGRAM_WEBHOOK_SECRET'],
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
