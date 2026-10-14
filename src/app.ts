import type { Bot } from 'grammy';
import { logger } from './core/logging/logger.ts';
import { closeServer, listenOn } from './http/server.ts';
import { activateTelegram, telegramServer } from './bot/listen.ts';
import type { ListenOptions } from './bot/listen.ts';

const log = logger.child({ module: 'app' });

export interface Running {
  port: number;
  close(): Promise<void>;
}

export async function serve(bot: Bot, options: ListenOptions): Promise<Running> {
  const server = telegramServer(bot, options);

  try {
    const port = await listenOn(server, options.port);

    await activateTelegram(bot, options);

    log.info('listening', {
      port,
      telegram: options.publicUrl === undefined ? 'polling' : 'webhook',
    });

    return {
      port,
      async close() {
        if (options.publicUrl === undefined) {
          await bot.stop();
        }

        await closeServer(server);
      },
    };
  } catch (error) {
    server.close();
    throw error;
  }
}
