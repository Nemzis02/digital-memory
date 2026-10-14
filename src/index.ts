import './config/load-env.ts';
import { Api } from 'grammy';
import { getEnv } from './config/env.ts';
import { createConversationLog } from './core/conversation/store.ts';
import { closeDatabase } from './core/db/client.ts';
import { logger } from './core/logging/logger.ts';
import { ingestionPipeline } from './core/pipeline/graph.ts';
import { stubIntentClassifier } from './core/retrieval/intent.ts';
import { serve } from './app.ts';
import { createBot } from './bot/bot.ts';
import { telegramFileSource } from './bot/files.ts';

const log = logger.child({ module: 'app' });

async function shutdown(close: () => Promise<void>, signal: NodeJS.Signals): Promise<void> {
  log.info('shutting down', { signal });
  await close();
  await closeDatabase();
}

async function main(): Promise<void> {
  const env = getEnv();

  const files = telegramFileSource(new Api(env.TELEGRAM_BOT_TOKEN), env.TELEGRAM_BOT_TOKEN);
  const pipeline = ingestionPipeline(files);

  await pipeline.init();

  const bot = createBot({
    token: env.TELEGRAM_BOT_TOKEN,
    adminId: env.TELEGRAM_ADMIN_ID,
    classifier: stubIntentClassifier(),
    pipeline,
    conversations: createConversationLog(),
  });

  const running = await serve(bot, {
    port: env.PORT,
    publicUrl: env.PUBLIC_URL,
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
  });

  let stopping = false;

  const stop = (signal: NodeJS.Signals) => {
    if (stopping) {
      return;
    }

    stopping = true;
    void shutdown(() => running.close(), signal);
  };

  process.once('SIGINT', () => {
    stop('SIGINT');
  });

  process.once('SIGTERM', () => {
    stop('SIGTERM');
  });
}

main().catch((error: unknown) => {
  log.error('failed to start', { error });
  process.exitCode = 1;
});
