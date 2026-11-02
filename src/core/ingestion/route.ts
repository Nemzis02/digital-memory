import type { UUID } from 'node:crypto';
import type { TurnOptions } from '../agent/turn.ts';
import type { ConversationLog } from '../conversation/store.ts';
import { contextWindow } from '../conversation/context.ts';
import type { ConversationTurn } from '../conversation/context.ts';
import type { ForgetRequests } from '../forget/requests.ts';
import { logger } from '../logging/logger.ts';
import type { MemorySource } from '../memory/payload.ts';
import type { IngestionPipeline } from '../pipeline/graph.ts';
import { NOTHING_FOUND } from '../retrieval/answer.ts';
import { traceTurn } from '../telemetry/telemetry.ts';
import type { InboundMessage } from './inbound.ts';
import { turnBody } from './inbound.ts';
import { present, savedReply, type RouteReply, type TurnReply } from './reply.ts';

const log = logger.child({ module: 'ingestion/route' });

const FORGOTTEN = 'Forgotten.';

const NOT_KEPT = 'Not kept.';

export type RunTurn = (
  message: InboundMessage,
  context: readonly ConversationTurn[],
  options?: TurnOptions,
) => Promise<TurnReply>;

export interface RouteDeps {
  source: MemorySource;
  pipeline: IngestionPipeline;
  conversations: ConversationLog;
  forgetRequests: ForgetRequests;
  turn: RunTurn;
  /** Removes each parent that still exists and returns how many it removed. */
  forget(parentIds: readonly UUID[]): Promise<number>;
  now?: () => Date;
}

export interface DispatchOptions {
  /** False on the re-run after Undo. */
  saving?: boolean;
  userTurn?: { body: string; sourceRef: string };
}

export function forgetResult(removed: number, total: number): RouteReply {
  if (removed === 0) {
    return present({ text: NOTHING_FOUND, keyboard: 'none' });
  }

  if (total === 1) {
    return present({ text: FORGOTTEN, keyboard: 'none' });
  }

  if (removed === total) {
    return present({ text: `Forgotten ${String(total)} memories.`, keyboard: 'none' });
  }

  return present({
    text: `Forgotten ${String(removed)} of ${String(total)} memories. The others were already gone.`,
    keyboard: 'none',
  });
}

/** Stores the proposed ids so the button needs only a request id: callback data holds 64 bytes. */
async function requested(
  deps: RouteDeps,
  message: InboundMessage,
  reply: Extract<TurnReply, { keyboard: 'forget' }>,
): Promise<RouteReply> {
  const requestId = await deps.forgetRequests.create({
    chatRef: message.chatRef,
    memoryIds: reply.candidates.map((candidate) => candidate.id),
  });

  return { text: reply.text, keyboard: 'forget', requestId };
}

function captionless(message: InboundMessage): boolean {
  return message.file !== undefined && message.text.trim() === '';
}

async function respond(
  deps: RouteDeps,
  message: InboundMessage,
  saving: boolean | undefined,
): Promise<RouteReply> {
  // A file with no caption leaves nothing for a model to decide, so it is kept as is.
  if (captionless(message)) {
    if (saving === false) {
      return present({ text: NOT_KEPT, keyboard: 'none' });
    }

    const identity = { source: deps.source, chatRef: message.chatRef, userRef: message.userRef };

    return traceTurn(identity, async (setOutcome) => {
      const result = await deps.pipeline.ingest({ source: deps.source, message });

      log.info('ingested', { id: result.id, type: message.type, points: result.points });
      setOutcome('saved');

      return present({ text: savedReply(result), keyboard: 'undo' });
    });
  }

  const now = deps.now ?? (() => new Date());

  const context = contextWindow(
    await deps.conversations.turns(message.chatRef, message.replyToSourceRef),
    now(),
    message.replyToSourceRef,
  );

  const reply = await deps.turn(message, context, saving === undefined ? undefined : { saving });

  return reply.keyboard === 'forget' ? requested(deps, message, reply) : reply;
}

export async function dispatch(
  deps: RouteDeps,
  message: InboundMessage,
  send: (reply: RouteReply) => Promise<string>,
  options?: DispatchOptions,
): Promise<RouteReply> {
  const reply = await respond(deps, message, options?.saving);
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
