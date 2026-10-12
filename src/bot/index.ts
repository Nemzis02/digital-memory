import '../config/load-env.ts';
import { getEnv } from '../config/env.ts';
import { createConversationLog } from '../core/conversation/store.ts';
import { closeDatabase } from '../core/db/client.ts';
import { logger } from '../core/logging/logger.ts';
import { stubIntentClassifier } from '../core/retrieval/intent.ts';
import { r2Storage } from '../core/storage/r2.ts';
import { start } from './listen.ts';

const log = logger.child({ module: 'bot' });

async function shutdown(close: () => Promise<void>, signal: NodeJS.Signals): Promise<void> {
  log.info('shutting down', { signal });
  await close();
  await closeDatabase();
}

async function main(): Promise<void> {
  const env = getEnv();

  const running = await start(
    {
      token: env.TELEGRAM_BOT_TOKEN,
      adminId: env.TELEGRAM_ADMIN_ID,
      classifier: stubIntentClassifier(),
      storage: r2Storage(),
      conversations: createConversationLog(),
    },
    {
      port: env.PORT,
      publicUrl: env.PUBLIC_URL,
      webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
    },
  );

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
  log.error('bot failed to start', { error });
  process.exitCode = 1;
});
