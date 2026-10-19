import type { UUID } from 'node:crypto';
import { InlineKeyboard, type Context } from 'grammy';
import type { CallbackQuery, Message, MaybeInaccessibleMessage, User } from 'grammy/types';
import { z } from 'zod';
import { logger } from '../../core/logging/logger.ts';
import { dispatch, forgetResult } from '../../core/ingestion/route.ts';
import type { RouteDeps, RouteReply } from '../../core/ingestion/route.ts';
import type { InboundFile, InboundMessage } from '../../core/ingestion/inbound.ts';
import { turnBody } from '../../core/ingestion/inbound.ts';

const log = logger.child({ module: 'bot/handlers' });

export const UNSUPPORTED = "Can't store that.";

const STORE_FAILED = 'Could not store that.';

const CALLBACK = { undo: 'undo', save: 'save' } as const;

const FORGET_PREFIX = 'forget:';

const FORGET_FAILED = 'Could not forget that.';

function displayName(from: User): string {
  return [from.first_name, from.last_name]
    .filter((part) => part !== undefined && part !== '')
    .join(' ');
}

function fileOf(fileId: string, fileName?: string, mimeType?: string): InboundFile {
  return {
    fileId,
    ...(fileName === undefined ? {} : { fileName }),
    ...(mimeType === undefined ? {} : { mimeType }),
  };
}

export function inboundFromMessage(message: Message, from: User): InboundMessage | undefined {
  const replyTo = message.reply_to_message;

  const base = {
    sourceRef: String(message.message_id),
    chatRef: String(message.chat.id),
    userRef: String(from.id),
    displayName: displayName(from),
    text: message.text ?? message.caption ?? '',
    ...(replyTo === undefined ? {} : { replyToSourceRef: String(replyTo.message_id) }),
  };

  const photo = message.photo?.at(-1);

  if (photo !== undefined) {
    return { ...base, type: 'photo', file: fileOf(photo.file_id) };
  }

  if (message.voice !== undefined) {
    return {
      ...base,
      type: 'voice',
      file: fileOf(message.voice.file_id, undefined, message.voice.mime_type),
    };
  }

  if (message.document !== undefined) {
    return {
      ...base,
      type: 'document',
      file: fileOf(
        message.document.file_id,
        message.document.file_name,
        message.document.mime_type,
      ),
    };
  }

  if (message.text === undefined) {
    return undefined;
  }

  const trimmed = message.text.trim();

  try {
    const url = new URL(trimmed);

    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return { ...base, type: 'url', text: trimmed, sourceUrl: trimmed };
    }
  } catch {
    // Not a lone URL. The text is the note.
  }

  return { ...base, type: 'text' };
}

export function replyMarkup(reply: RouteReply): InlineKeyboard | undefined {
  switch (reply.keyboard) {
    case 'none':
      return undefined;
    case 'undo':
      return new InlineKeyboard().text('Undo', CALLBACK.undo);
    case 'save':
      return new InlineKeyboard().text('Save', CALLBACK.save);
    case 'forget':
      return new InlineKeyboard().text('Forget', `${FORGET_PREFIX}${reply.parentId}`);
  }
}

async function sendReply(ctx: Context, messageId: number, reply: RouteReply): Promise<string> {
  const markup = replyMarkup(reply);

  // The undo button reads callback_query.message.reply_to_message, so this has to be a real reply.
  const sent = await ctx.reply(reply.text, {
    reply_parameters: { message_id: messageId },
    ...(markup === undefined ? {} : { reply_markup: markup }),
  });

  return String(sent.message_id);
}

async function recordFailure(
  deps: RouteDeps,
  message: InboundMessage,
  sentRef: string,
): Promise<void> {
  await deps.conversations.append({
    chatRef: message.chatRef,
    userRef: message.userRef,
    ...(message.displayName === undefined ? {} : { displayName: message.displayName }),
    user: { body: turnBody(message), sourceRef: message.sourceRef },
    assistant: { body: STORE_FAILED, sourceRef: sentRef },
  });
}

export async function handleMessage(ctx: Context, deps: RouteDeps): Promise<void> {
  const message = ctx.message;
  const from = ctx.from;

  if (message === undefined || from === undefined) {
    return;
  }

  const inbound = inboundFromMessage(message, from);

  if (inbound === undefined) {
    const sent = await ctx.reply(UNSUPPORTED);

    await deps.conversations.append({
      chatRef: String(message.chat.id),
      userRef: String(from.id),
      displayName: displayName(from),
      user: { body: '[unsupported]', sourceRef: String(message.message_id) },
      assistant: { body: UNSUPPORTED, sourceRef: String(sent.message_id) },
    });

    return;
  }

  try {
    await dispatch(deps, inbound, (reply) => sendReply(ctx, message.message_id, reply));
  } catch (error) {
    log.error('failed to store message', { error });

    const sent = await ctx.reply(STORE_FAILED, {
      reply_parameters: { message_id: message.message_id },
    });

    await recordFailure(deps, inbound, String(sent.message_id)).catch((appendError: unknown) => {
      log.error('failed to record the failure', { error: appendError });
    });
  }
}

function isAccessible(message: MaybeInaccessibleMessage): message is Message {
  return message.date !== 0;
}

function callbackMessage(callback: CallbackQuery): Message | undefined {
  const message = callback.message;

  if (message === undefined || !isAccessible(message)) {
    return undefined;
  }

  return message;
}

function forgetId(data: string): UUID | undefined {
  if (!data.startsWith(FORGET_PREFIX)) {
    return undefined;
  }

  const parsed = z
    .uuid()
    .transform((value) => value as UUID)
    .safeParse(data.slice(FORGET_PREFIX.length));

  return parsed.success ? parsed.data : undefined;
}

async function confirmForget(
  ctx: Context,
  deps: RouteDeps,
  callback: CallbackQuery,
  parentId: UUID,
): Promise<void> {
  let removed: boolean;

  try {
    removed = await deps.retrieval.forget(parentId);
  } catch (error) {
    log.error('failed to forget', { error, id: parentId });

    await ctx.answerCallbackQuery();

    const message = callbackMessage(callback);

    if (message !== undefined) {
      await ctx.reply(FORGET_FAILED, {
        reply_parameters: { message_id: message.message_id },
      });
    }

    return;
  }

  const reply = forgetResult(removed);
  const message = callbackMessage(callback);

  if (message === undefined) {
    await ctx.answerCallbackQuery({ text: reply.text });
    return;
  }

  await ctx.answerCallbackQuery();

  const sent = await ctx.reply(reply.text, {
    reply_parameters: { message_id: message.message_id },
  });

  const name = displayName(callback.from);

  await deps.conversations
    .append({
      chatRef: String(message.chat.id),
      userRef: String(callback.from.id),
      ...(name === '' ? {} : { displayName: name }),
      user: { body: 'forget', sourceRef: callback.id },
      assistant: { body: reply.text, sourceRef: String(sent.message_id) },
    })
    .catch((error: unknown) => {
      log.error('failed to record exchange', { error });
    });
}

export async function handleCallback(ctx: Context, deps: RouteDeps): Promise<void> {
  const callback = ctx.callbackQuery;

  if (callback === undefined) {
    return;
  }

  const data = callback.data;

  if (data === undefined) {
    await ctx.answerCallbackQuery();
    return;
  }

  if (data.startsWith(FORGET_PREFIX)) {
    const parentId = forgetId(data);

    if (parentId === undefined) {
      await ctx.answerCallbackQuery();
      return;
    }

    await confirmForget(ctx, deps, callback, parentId);
    return;
  }

  const action = data === CALLBACK.undo || data === CALLBACK.save ? data : undefined;

  const message = callbackMessage(callback);
  const replied = message?.reply_to_message;
  const accessible = replied !== undefined && isAccessible(replied) ? replied : undefined;
  const from = accessible?.from;

  const original =
    action !== undefined && accessible !== undefined && from !== undefined
      ? inboundFromMessage(accessible, from)
      : undefined;

  if (action === undefined) {
    await ctx.answerCallbackQuery();
    return;
  }

  if (message === undefined || accessible === undefined || original === undefined) {
    await ctx.answerCallbackQuery({ text: 'Original message is gone' });
    return;
  }

  await ctx.answerCallbackQuery();

  if (action === CALLBACK.undo) {
    await deps.pipeline
      .undo({ source: deps.source, sourceRef: original.sourceRef })
      .catch((error: unknown) => {
        log.error('failed to undo the ingestion', { error, sourceRef: original.sourceRef });
      });
  }

  try {
    await dispatch(deps, original, (reply) => sendReply(ctx, accessible.message_id, reply), {
      intent: action === CALLBACK.undo ? 'ask' : 'save',
      userTurn: { body: action, sourceRef: callback.id },
    });
  } catch (error) {
    log.error('failed to reroute message', { error });

    await ctx.reply(STORE_FAILED, {
      reply_parameters: { message_id: accessible.message_id },
    });
  }
}
