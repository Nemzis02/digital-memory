import { Bot } from 'grammy';
import type { ConversationLog } from '../core/conversation/store.ts';
import type { FileSource } from '../core/ingestion/file-source.ts';
import type { RouteDeps } from '../core/ingestion/route.ts';
import { logger } from '../core/logging/logger.ts';
import type { IntentClassifier } from '../core/retrieval/intent.ts';
import type { ObjectStorage } from '../core/storage/object-storage.ts';
import { handleCallback, handleMessage } from './handlers/updates.ts';
import { telegramFileSource } from './files.ts';
import { adminOnly } from './middleware/admin.ts';

const log = logger.child({ module: 'bot' });

export interface BotDependencies {
  token: string;
  adminId: number;
  classifier: IntentClassifier;
  storage: ObjectStorage;
  conversations: ConversationLog;
  files?: FileSource;
  now?: () => Date;
}

export function createBot(deps: BotDependencies): Bot {
  const bot = new Bot(deps.token);
  const files = deps.files ?? telegramFileSource(bot.api, deps.token);

  const runtime: RouteDeps = {
    classifier: deps.classifier,
    files,
    storage: deps.storage,
    conversations: deps.conversations,
    ...(deps.now === undefined ? {} : { now: deps.now }),
  };

  bot.use(adminOnly(deps.adminId));
  bot.on('message', (ctx) => handleMessage(ctx, runtime));
  bot.on('callback_query:data', (ctx) => handleCallback(ctx, runtime));

  bot.catch((err) => {
    log.error('update failed', { error: err.error });
  });

  return bot;
}
