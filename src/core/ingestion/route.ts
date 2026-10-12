import type { ConversationLog } from '../conversation/store.ts';
import { contextWindow } from '../conversation/context.ts';
import type { ConversationTurn } from '../conversation/context.ts';
import { logger } from '../logging/logger.ts';
import type { MemorySource } from '../memory/payload.ts';
import type { IngestResult, IngestionPipeline } from '../pipeline/graph.ts';
import type { Intent, IntentClassifier } from '../retrieval/intent.ts';
import type { InboundMessage } from './inbound.ts';
import { turnBody } from './inbound.ts';

const log = logger.child({ module: 'ingestion/route' });

export const NOT_BUILT_YET = 'not built yet';

export interface RouteReply {
  text: string;
  keyboard: 'undo' | 'save';
}

export interface RouteDeps {
  source: MemorySource;
  classifier: IntentClassifier;
  pipeline: IngestionPipeline;
  conversations: ConversationLog;
  now?: () => Date;
}

export function savedReply(result: IngestResult): string {
  return [`Saved ${result.kind} · ${result.category}`, result.summary, result.tags.join(' ')]
    .filter((line) => line !== '')
    .join('\n');
}

export async function respond(
  deps: Pick<RouteDeps, 'source' | 'classifier' | 'pipeline'>,
  message: InboundMessage,
  context: readonly ConversationTurn[],
  forced?: Intent,
): Promise<RouteReply> {
  const intent =
    forced ?? (await deps.classifier.classify({ text: turnBody(message), context })).intent;

  if (intent !== 'save') {
    return { text: NOT_BUILT_YET, keyboard: 'save' };
  }

  const result = await deps.pipeline.ingest({ source: deps.source, message });

  log.info('ingested', { id: result.id, type: message.type, points: result.points });

  return { text: savedReply(result), keyboard: 'undo' };
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
