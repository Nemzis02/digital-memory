import { Bot } from 'grammy';
import type { ConversationLog } from '../core/conversation/store.ts';
import type { Retrieval, RouteDeps } from '../core/ingestion/route.ts';
import { logger } from '../core/logging/logger.ts';
import type { IngestionPipeline } from '../core/pipeline/graph.ts';
import type { IntentClassifier } from '../core/retrieval/intent.ts';
import type { ObjectStorage } from '../core/storage/object-storage.ts';
import { handleCallback, handleMessage } from './handlers/updates.ts';
import { adminOnly } from './middleware/admin.ts';

const log = logger.child({ module: 'bot' });

export interface BotDependencies {
  token: string;
  adminId: number;
  classifier: IntentClassifier;
  pipeline: IngestionPipeline;
  conversations: ConversationLog;
  retrieval: Retrieval;
  storage: ObjectStorage;
  now?: () => Date;
}

export function createBot(deps: BotDependencies): Bot {
  const bot = new Bot(deps.token);

  const runtime: RouteDeps = {
    source: 'telegram',
    classifier: deps.classifier,
    pipeline: deps.pipeline,
    conversations: deps.conversations,
    retrieval: deps.retrieval,
    ...(deps.now === undefined ? {} : { now: deps.now }),
  };

  bot.use(adminOnly(deps.adminId));
  bot.on('message', (ctx) => handleMessage(ctx, runtime, deps.storage));
  bot.on('callback_query:data', (ctx) => handleCallback(ctx, runtime, deps.storage));

  bot.catch((err) => {
    log.error('update failed', { error: err.error });
  });

  return bot;
}
