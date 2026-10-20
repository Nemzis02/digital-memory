import { Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import { InputFile, InputMediaBuilder, type Context, type InlineKeyboard } from 'grammy';
import type { InputMediaDocument, InputMediaPhoto } from 'grammy/types';
import { splitMessage } from 'md-to-telegram';
import type { ReplyFile } from '../core/ingestion/route.ts';
import { logger } from '../core/logging/logger.ts';
import type { ObjectStorage, OpenedObject } from '../core/storage/object-storage.ts';

const log = logger.child({ module: 'bot/attachments' });

const PHOTO_BYTES = 10 * 1024 * 1024;

const DOCUMENT_BYTES = 50 * 1024 * 1024;

const NOTICE_LIMIT = 4096;

const CAPTION_LIMIT = 1024;

const ALBUM_LIMIT = 10;

function unsentLine(summary: string, size?: number): string {
  const detail =
    size === undefined ? 'not attached' : `${Math.ceil(size / (1024 * 1024))} MB, not attached`;

  return `${summary} · ${detail}`.slice(0, NOTICE_LIMIT);
}

async function notifyUnsent(
  ctx: Context,
  messageId: number,
  summary: string,
  size?: number,
): Promise<void> {
  await ctx.reply(unsentLine(summary, size), {
    reply_parameters: { message_id: messageId },
  });
}

type Media = 'photo' | 'document';

interface Attachment {
  file: ReplyFile;
  opened: OpenedObject;
  media: Media;
}

// grammY writes `filename=<name>` unquoted into the multipart header, so these would end it early.
function multipartName(name: string): string {
  return name.replaceAll(/[;"\\]/g, '_');
}

// S3 bodies are IncomingMessages, and grammY fetches anything with a `url` key as a URL.
export function storedInputFile(body: Readable, key: string, name?: string): InputFile {
  const basename = key.slice(key.lastIndexOf('/') + 1);

  return new InputFile(
    Readable.toWeb(body) as ReadableStream<Uint8Array>,
    name === undefined ? (basename === '' ? undefined : basename) : multipartName(name),
  );
}

function inputFile(attachment: Attachment): InputFile {
  const { key, name } = attachment.file;

  return storedInputFile(attachment.opened.body, key, name);
}

async function openAttachment(
  ctx: Context,
  messageId: number,
  storage: ObjectStorage,
  file: ReplyFile,
): Promise<Attachment | undefined> {
  let opened: OpenedObject;

  try {
    opened = await storage.openSized(file.key);
  } catch (error: unknown) {
    log.error('failed to open citation', { error });
    await notifyUnsent(ctx, messageId, file.summary);
    return undefined;
  }

  const size = opened.size;

  if (size === undefined || size > DOCUMENT_BYTES) {
    opened.body.destroy();

    await (size === undefined
      ? notifyUnsent(ctx, messageId, file.summary)
      : notifyUnsent(ctx, messageId, file.summary, size));

    return undefined;
  }

  const media = file.type === 'photo' && size <= PHOTO_BYTES ? 'photo' : 'document';

  return { file, opened, media };
}

function sendSingle(
  ctx: Context,
  attachment: Attachment,
  options: {
    caption: string;
    reply_parameters: { message_id: number };
    parse_mode?: 'HTML';
    reply_markup?: InlineKeyboard;
  },
): Promise<{ message_id: number }> {
  const input = inputFile(attachment);

  return attachment.media === 'photo'
    ? ctx.replyWithPhoto(input, { ...options, show_caption_above_media: true })
    : ctx.replyWithDocument(input, options);
}

async function giveUp(
  ctx: Context,
  messageId: number,
  attachments: readonly Attachment[],
  error: unknown,
): Promise<void> {
  log.error('failed to send citation', { error });

  for (const attachment of attachments) {
    attachment.opened.body.destroy();
    await notifyUnsent(ctx, messageId, attachment.file.summary);
  }
}

async function sendBatch(
  ctx: Context,
  messageId: number,
  attachments: readonly Attachment[],
): Promise<void> {
  const replyTo = { reply_parameters: { message_id: messageId } };

  for (const media of ['photo', 'document'] as const) {
    const group = attachments.filter((attachment) => attachment.media === media);
    const [only] = group;

    if (group.length === 1 && only !== undefined) {
      await sendSingle(ctx, only, {
        caption: only.file.summary.slice(0, CAPTION_LIMIT),
        ...replyTo,
      }).catch((error: unknown) => giveUp(ctx, messageId, group, error));

      continue;
    }

    if (group.length === 0) {
      continue;
    }

    const items = group.map((attachment) => {
      const options = { caption: attachment.file.summary.slice(0, CAPTION_LIMIT) };

      return media === 'photo'
        ? InputMediaBuilder.photo(inputFile(attachment), options)
        : InputMediaBuilder.document(inputFile(attachment), options);
    });

    await (
      media === 'photo'
        ? ctx.replyWithMediaGroup(items as InputMediaPhoto[], replyTo)
        : ctx.replyWithMediaGroup(items as InputMediaDocument[], replyTo)
    ).catch((error: unknown) => giveUp(ctx, messageId, group, error));
  }
}

export async function sendFiles(
  ctx: Context,
  messageId: number,
  storage: ObjectStorage,
  files: readonly ReplyFile[],
): Promise<void> {
  const ordered = [
    ...files.filter((file) => file.type === 'photo'),
    ...files.filter((file) => file.type !== 'photo'),
  ];

  // Opened one album at a time so no R2 stream idles while another album uploads.
  for (let start = 0; start < ordered.length; start += ALBUM_LIMIT) {
    const opened: Attachment[] = [];

    for (const file of ordered.slice(start, start + ALBUM_LIMIT)) {
      const attachment = await openAttachment(ctx, messageId, storage, file);

      if (attachment !== undefined) {
        opened.push(attachment);
      }
    }

    await sendBatch(ctx, messageId, opened);
  }
}

function fitsCaption(html: string | undefined): html is string {
  return (
    html !== undefined &&
    html.trim() !== '' &&
    splitMessage(html, { format: 'html', maxLength: CAPTION_LIMIT }).length === 1
  );
}

/** Sends `lead` with `html` as its caption; `'unsent'` when the file itself could not be opened. */
export async function sendCaptioned(
  ctx: Context,
  messageId: number,
  storage: ObjectStorage,
  lead: ReplyFile,
  html: string | undefined,
  markup: InlineKeyboard | undefined,
): Promise<{ message_id: number } | 'unsent' | undefined> {
  if (!fitsCaption(html)) {
    return undefined;
  }

  const attachment = await openAttachment(ctx, messageId, storage, lead);

  if (attachment === undefined) {
    return 'unsent';
  }

  try {
    return await sendSingle(ctx, attachment, {
      caption: html,
      parse_mode: 'HTML',
      reply_parameters: { message_id: messageId },
      ...(markup === undefined ? {} : { reply_markup: markup }),
    });
  } catch (error: unknown) {
    log.error('failed to send the answer as a caption', { error });
    attachment.opened.body.destroy();

    return undefined;
  }
}
