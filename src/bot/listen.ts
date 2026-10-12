import type { Server } from 'node:http';
import { webhookCallback } from 'grammy';
import type { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import { logger } from '../core/logging/logger.ts';
import { createBot } from './bot.ts';
import type { BotDependencies } from './bot.ts';
import { createWebhookServer, telegramWebhookUrl } from './webhook.ts';

const log = logger.child({ module: 'bot/listen' });

const UPDATES: ReadonlyArray<Exclude<keyof Update, 'update_id'>> = ['message', 'callback_query'];

export interface ListenOptions {
  port: number;
  publicUrl?: string | undefined;
  webhookSecret?: string | undefined;
}

export interface Running {
  port?: number;
  close(): Promise<void>;
}

function listenOn(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);

    server.listen(port, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

export async function listen(bot: Bot, options: ListenOptions): Promise<Running> {
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

    return {
      async close() {
        await bot.stop();
      },
    };
  }

  if (options.webhookSecret === undefined) {
    throw new Error('TELEGRAM_WEBHOOK_SECRET is required once PUBLIC_URL is set');
  }

  const secret = options.webhookSecret;
  const url = telegramWebhookUrl(options.publicUrl);

  const handle = webhookCallback(bot, 'http', {
    secretToken: secret,
    timeoutMilliseconds: 30_000,
  });

  const server = createWebhookServer({ secret, handle });

  try {
    await listenOn(server, options.port);
    await bot.api.setWebhook(url, { secret_token: secret, allowed_updates: UPDATES });
  } catch (error) {
    server.close();
    throw error;
  }

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : options.port;

  log.info('webhook listening', { port, path: new URL(url).pathname });

  return { port, close: () => closeServer(server) };
}

export async function start(deps: BotDependencies, options: ListenOptions): Promise<Running> {
  return listen(createBot(deps), options);
}
