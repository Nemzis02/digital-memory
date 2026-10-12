import type { ConversationLog } from '../conversation/store.ts';
import { contextWindow } from '../conversation/context.ts';
import type { ConversationTurn } from '../conversation/context.ts';
import { logger } from '../logging/logger.ts';
import type { Intent, IntentClassifier } from '../retrieval/intent.ts';
import type { FileSource } from './file-source.ts';
import type { InboundMessage } from './inbound.ts';
import { turnBody } from './inbound.ts';
import { storedReply, storeInbound } from './save.ts';
import type { ObjectStorage } from '../storage/object-storage.ts';

const log = logger.child({ module: 'ingestion/route' });

export const NOT_BUILT_YET = 'not built yet';

export interface RouteReply {
  text: string;
  keyboard: 'undo' | 'save';
}

export interface RouteDeps {
  classifier: IntentClassifier;
  files: FileSource;
  storage: ObjectStorage;
  conversations: ConversationLog;
  now?: () => Date;
}

export async function respond(
  deps: Pick<RouteDeps, 'classifier' | 'files' | 'storage'>,
  message: InboundMessage,
  context: readonly ConversationTurn[],
  forced?: Intent,
): Promise<RouteReply> {
  const intent =
    forced ?? (await deps.classifier.classify({ text: turnBody(message), context })).intent;

  if (intent !== 'save') {
    return { text: NOT_BUILT_YET, keyboard: 'save' };
  }

  const stored = await storeInbound(message, deps.files, deps.storage);

  log.info('stored', { type: stored.type, key: stored.key });

  return { text: storedReply(stored.type, stored.key), keyboard: 'undo' };
}

export async function dispatch(
  deps: RouteDeps,
  message: InboundMessage,
  send: (reply: RouteReply) => Promise<string>,
  options?: { intent?: Intent; userTurn?: { body: string; sourceRef: string } },
): Promise<RouteReply> {
  const now = deps.now ?? (() => new Date());

  const context =
    options?.intent === undefined
      ? contextWindow(
          await deps.conversations.turns(message.chatRef, message.replyToSourceRef),
          now(),
          message.replyToSourceRef,
        )
      : [];

  const reply = await respond(deps, message, context, options?.intent);
  const sentRef = await send(reply);
  const userTurn = options?.userTurn ?? { body: turnBody(message), sourceRef: message.sourceRef };

  await deps.conversations
    .append({
      chatRef: message.chatRef,
      userRef: message.userRef,
      ...(message.displayName === undefined ? {} : { displayName: message.displayName }),
      user: userTurn,
      assistant: { body: reply.text, sourceRef: sentRef },
    })
    .catch((error: unknown) => {
      log.error('failed to record exchange', { error });
    });

  return reply;
}
