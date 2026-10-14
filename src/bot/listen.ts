import { webhookCallback } from 'grammy';
import type { Bot } from 'grammy';
import type { Server } from 'node:http';
import type { Update } from 'grammy/types';
import { logger } from '../core/logging/logger.ts';
import { createHttpServer } from '../http/server.ts';
import { createWebhookServer, telegramWebhookUrl } from './webhook.ts';

const log = logger.child({ module: 'bot/listen' });

const UPDATES: ReadonlyArray<Exclude<keyof Update, 'update_id'>> = ['message', 'callback_query'];

export interface ListenOptions {
  port: number;
  publicUrl?: string | undefined;
  webhookSecret?: string | undefined;
}

export function telegramServer(bot: Bot, options: ListenOptions): Server {
  if (options.publicUrl === undefined) {
    return createHttpServer([]);
  }

  const secret = options.webhookSecret;

  if (secret === undefined) {
    throw new Error('TELEGRAM_WEBHOOK_SECRET is required once PUBLIC_URL is set');
  }

  return createWebhookServer({
    secret,
    handle: webhookCallback(bot, 'http', {
      secretToken: secret,
      timeoutMilliseconds: 30_000,
    }),
  });
}

export async function activateTelegram(bot: Bot, options: ListenOptions): Promise<void> {
  if (options.publicUrl === undefined) {
    await bot.api.deleteWebhook();

    void bot
      .start({
        allowed_updates: UPDATES,
        onStart: (me) => {
          log.info('polling', { username: me.username });
        },
      })
      .catch((error: unknown) => {
        log.error('polling failed', { error });
        process.exitCode = 1;
      });

    return;
  }

  const secret = options.webhookSecret;

  if (secret === undefined) {
    throw new Error('TELEGRAM_WEBHOOK_SECRET is required once PUBLIC_URL is set');
  }

  const url = telegramWebhookUrl(options.publicUrl);

  await bot.api.setWebhook(url, { secret_token: secret, allowed_updates: UPDATES });

  log.info('webhook registered', { path: new URL(url).pathname });
}
