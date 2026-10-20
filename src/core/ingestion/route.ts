import type { UUID } from 'node:crypto';
import { toTelegramHTML } from 'md-to-telegram';
import type { ConversationLog } from '../conversation/store.ts';
import { contextWindow } from '../conversation/context.ts';
import type { ConversationTurn } from '../conversation/context.ts';
import type { ChatModel } from '../llm/router.ts';
import { logger } from '../logging/logger.ts';
import type { MemoryPayload, MemorySource } from '../memory/payload.ts';
import type { IngestResult, IngestionPipeline } from '../pipeline/graph.ts';
import { NOTHING_FOUND, type Answer, type CitationFile } from '../retrieval/answer.ts';
import type { Intent, IntentClassifier, IntentSlots } from '../retrieval/intent.ts';
import type { InboundMessage } from './inbound.ts';
import { turnBody } from './inbound.ts';

const log = logger.child({ module: 'ingestion/route' });

// sendMessage rejects anything longer, and a synthesised answer can exceed it.
const TELEGRAM_TEXT_LIMIT = 4096;

const FORGOTTEN = 'Forgotten.';

const CHAT_REPLY = "Ask me about something you've saved.";

const CHAT_SYSTEM =
  'The user greeted you or reacted. Reply in one or two sentences, in the language of their message. Do not invent saved memories. Do not say that a search happened.';

const MISS_SYSTEM =
  "Nothing in the user's archive matches what they asked. Reply with one sentence in the language of their message saying nothing is saved about it. Do not invent a memory.";

export interface Retrieval {
  ask(slots: IntentSlots): Promise<Answer>;
  recall(slots: IntentSlots): Promise<MemoryPayload[]>;
  resolveForget(slots: IntentSlots): Promise<MemoryPayload | undefined>;
  forget(parentId: UUID): Promise<boolean>;
}

export interface ReplyFile extends CitationFile {
  summary: string;
}

export type RouteReply =
  | { text: string; html?: string; files?: ReplyFile[]; keyboard: 'undo' | 'save' }
  | { text: string; html?: string; keyboard: 'forget'; parentId: UUID }
  | { text: string; html?: string; keyboard: 'none' };

export interface RouteDeps {
  source: MemorySource;
  classifier: IntentClassifier;
  pipeline: IngestionPipeline;
  conversations: ConversationLog;
  retrieval: Retrieval;
  fast: ChatModel;
  now?: () => Date;
}

async function phrase(
  model: ChatModel,
  system: string,
  text: string,
  fallback: string,
): Promise<string> {
  try {
    const reply = (
      await model.complete({
        system,
        turns: [{ role: 'user', parts: [{ type: 'text', text }] }],
      })
    ).trim();

    return reply === '' ? fallback : reply;
  } catch (error: unknown) {
    log.error('failed to phrase a reply', { error });

    return fallback;
  }
}

function clip(text: string): string {
  return text.length <= TELEGRAM_TEXT_LIMIT ? text : text.slice(0, TELEGRAM_TEXT_LIMIT);
}

function present(reply: RouteReply): RouteReply {
  const text = clip(reply.text);

  return text === reply.text ? reply : { ...reply, text };
}

export function savedReply(result: IngestResult): string {
  return [`Saved ${result.kind} · ${result.category}`, result.summary, result.tags.join(' ')]
    .filter((line) => line !== '')
    .join('\n');
}

function day(epoch: number): string {
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function formatAnswer(answer: Answer): { text: string; html: string; files?: ReplyFile[] } {
  const lines = [answer.answer];
  const htmlLines = [toTelegramHTML(answer.answer).text];
  const files: ReplyFile[] = [];

  for (const citation of answer.citations) {
    const file = citation.file;

    if (file !== undefined) {
      files.push({ key: file.key, type: file.type, summary: citation.summary });
      continue;
    }

    lines.push('', citation.summary);

    const url = citation.url;

    if (url === undefined) {
      htmlLines.push('', escapeHtml(citation.summary));
      continue;
    }

    const href = escapeHtml(url).replaceAll('"', '&quot;');

    htmlLines.push('', `<a href="${href}">${escapeHtml(citation.summary)}</a>`);
  }

  return {
    text: lines.join('\n'),
    html: htmlLines.join('\n'),
    ...(files.length === 0 ? {} : { files }),
  };
}

function formatRecall(slots: IntentSlots, memories: readonly MemoryPayload[]): string {
  if (memories.length === 0) {
    return NOTHING_FOUND;
  }

  return memories
    .map((memory) => {
      const epoch =
        slots.orderBy === 'event_at' ? (memory.event_at ?? memory.created_at) : memory.created_at;

      return `${day(epoch)} · ${memory.summary}`;
    })
    .join('\n');
}

export function forgetResult(removed: boolean): RouteReply {
  return present({ text: removed ? FORGOTTEN : NOTHING_FOUND, keyboard: 'none' });
}

function slotsFor(intent: Intent, slots: IntentSlots, message: InboundMessage): IntentSlots {
  if (intent !== 'ask' && intent !== 'forget') {
    return slots;
  }

  const query = slots.query?.trim();

  if (query === undefined || query === '') {
    return { ...slots, query: turnBody(message) };
  }

  return query === slots.query ? slots : { ...slots, query };
}

export async function respond(
  deps: Pick<RouteDeps, 'source' | 'classifier' | 'pipeline' | 'retrieval' | 'fast'>,
  message: InboundMessage,
  context: readonly ConversationTurn[],
  forced?: Intent,
): Promise<RouteReply> {
  const classified =
    forced === undefined
      ? await deps.classifier.classify({ text: turnBody(message), context })
      : { intent: forced, slots: forced === 'save' ? {} : { query: turnBody(message) } };

  const slots = slotsFor(classified.intent, classified.slots, message);

  switch (classified.intent) {
    case 'save': {
      const result = await deps.pipeline.ingest({ source: deps.source, message });

      log.info('ingested', { id: result.id, type: message.type, points: result.points });

      return present({ text: savedReply(result), keyboard: 'undo' });
    }

    case 'ask': {
      const answer = await deps.retrieval.ask(slots);
      const formatted = formatAnswer(answer);
      const missed = formatted.text === NOTHING_FOUND;

      const text = missed
        ? await phrase(deps.fast, MISS_SYSTEM, turnBody(message), NOTHING_FOUND)
        : formatted.text;

      return present({
        text,
        html: missed ? escapeHtml(text) : formatted.html,
        keyboard: 'save',
        ...(formatted.files === undefined ? {} : { files: formatted.files }),
      });
    }

    case 'chat':
      return present({
        text: await phrase(deps.fast, CHAT_SYSTEM, turnBody(message), CHAT_REPLY),
        keyboard: 'none',
      });

    case 'recall-by-filter': {
      const memories = await deps.retrieval.recall(slots);
      const listed = formatRecall(slots, memories);

      return present({
        text:
          listed === NOTHING_FOUND
            ? await phrase(deps.fast, MISS_SYSTEM, turnBody(message), NOTHING_FOUND)
            : listed,
        keyboard: 'save',
      });
    }

    case 'forget': {
      const parent = await deps.retrieval.resolveForget(slots);

      if (parent === undefined) {
        return present({
          text: await phrase(deps.fast, MISS_SYSTEM, turnBody(message), NOTHING_FOUND),
          keyboard: 'save',
        });
      }

      return present({
        text: `Forget ${parent.summary}?`,
        keyboard: 'forget',
        parentId: parent.id,
      });
    }
  }
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
