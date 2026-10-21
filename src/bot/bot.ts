import { Bot } from 'grammy';
import type { ConversationLog } from '../core/conversation/store.ts';
import type { RouteDeps, RunTurn } from '../core/ingestion/route.ts';
import { logger } from '../core/logging/logger.ts';
import type { IngestionPipeline } from '../core/pipeline/graph.ts';
import type { ObjectStorage } from '../core/storage/object-storage.ts';
import { handleCallback, handleMessage } from './handlers/updates.ts';
import { adminOnly } from './middleware/admin.ts';

const log = logger.child({ module: 'bot' });

export interface BotDependencies {
  token: string;
  adminId: number;
  pipeline: IngestionPipeline;
  conversations: ConversationLog;
  turn: RunTurn;
  forget: RouteDeps['forget'];
  storage: ObjectStorage;
  now?: () => Date;
}

export function createBot(deps: BotDependencies): Bot {
  const bot = new Bot(deps.token);

  const runtime: RouteDeps = {
    source: 'telegram',
    pipeline: deps.pipeline,
    conversations: deps.conversations,
    turn: deps.turn,
    forget: deps.forget,
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
