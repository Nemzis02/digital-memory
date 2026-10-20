import './config/load-env.ts';
import { Api } from 'grammy';
import { getEnv } from './config/env.ts';
import { createConversationLog } from './core/conversation/store.ts';
import { closeDatabase } from './core/db/client.ts';
import type { Retrieval } from './core/ingestion/route.ts';
import { embeddings } from './core/llm/embeddings.ts';
import { llmRouter } from './core/llm/router.ts';
import { logger } from './core/logging/logger.ts';
import { ingestionPipeline } from './core/pipeline/graph.ts';
import { createIntentClassifier } from './core/retrieval/classifier.ts';
import { ask, forget, recall, resolveForget } from './core/retrieval/query.ts';
import { r2Storage } from './core/storage/r2.ts';
import { qdrantStore } from './core/vector/qdrant.ts';
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

  const router = llmRouter();
  const store = qdrantStore();
  const embedded = embeddings();
  const storage = r2Storage();

  const retrieval: Retrieval = {
    ask: (slots) => ask({ store, embeddings: embedded, model: router.model('strong') }, slots),
    recall: (slots) => recall(store, slots),
    resolveForget: (slots) => resolveForget({ store, embeddings: embedded }, slots),
    forget: (parentId) => forget({ store, storage }, parentId),
  };

  const bot = createBot({
    token: env.TELEGRAM_BOT_TOKEN,
    adminId: env.TELEGRAM_ADMIN_ID,
    classifier: createIntentClassifier({ router }),
    pipeline,
    conversations: createConversationLog(),
    retrieval,
    storage,
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
