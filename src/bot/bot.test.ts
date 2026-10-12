import type { Update, UserFromGetMe } from 'grammy/types';
import { describe, expect, it } from 'vitest';
import type { AppendExchange, ConversationLog } from '../core/conversation/store.ts';
import type { ConversationTurn } from '../core/conversation/context.ts';
import type { FileSource } from '../core/ingestion/file-source.ts';
import { stubIntentClassifier } from '../core/retrieval/intent.ts';
import { objectKey } from '../core/storage/content.ts';
import type { ObjectStorage, UploadInput } from '../core/storage/object-storage.ts';
import { createBot } from './bot.ts';

const TOKEN = '123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; // gitleaks:allow

const ME: UserFromGetMe = {
  id: 1,
  is_bot: true,
  first_name: 'memory',
  username: 'memory_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  supports_join_request_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
};

const ADMIN = 42;

interface Sent {
  method: string;
  payload: { text?: string; reply_parameters?: { message_id?: number }; reply_markup?: unknown };
}

function memoryLog(): ConversationLog & { exchanges: AppendExchange[] } {
  const history: ConversationTurn[] = [];
  const exchanges: AppendExchange[] = [];

  return {
    exchanges,
    turns() {
      return Promise.resolve(history);
    },
    append(exchange) {
      exchanges.push(exchange);
      const createdAt = new Date();

      history.push({
        role: 'user',
        body: exchange.user.body,
        sourceRef: exchange.user.sourceRef,
        createdAt,
      });

      history.push({
        role: 'assistant',
        body: exchange.assistant.body,
        sourceRef: exchange.assistant.sourceRef,
        createdAt: new Date(createdAt.getTime() + 1),
      });

      return Promise.resolve();
    },
  };
}

function recordingStorage(): {
  storage: ObjectStorage;
  uploads: UploadInput[];
  removed: string[];
  keys: string[];
} {
  const uploads: UploadInput[] = [];
  const removed: string[] = [];
  const keys: string[] = [];

  return {
    uploads,
    removed,
    keys,
    storage: {
      upload(input) {
        uploads.push(input);

        const extension =
          input.fileName?.split('.').pop() ??
          (input.kind === 'photo' ? 'jpg' : input.kind === 'voice' ? 'ogg' : 'bin');

        const key = objectKey(input.kind, extension);

        keys.push(key);

        return Promise.resolve({
          key,
          size: input.body.byteLength,
          contentType: input.contentType ?? 'application/octet-stream',
        });
      },
      presignDownload() {
        return Promise.resolve('signed');
      },
      openStream() {
        return Promise.reject(new Error('unused'));
      },
      remove(key) {
        removed.push(key);

        return Promise.resolve();
      },
    },
  };
}

function harness() {
  const sent: Sent[] = [];
  let messageId = 50;
  const downloads: string[] = [];
  const bytes = new Uint8Array([1, 2, 3, 4]);

  const files: FileSource = {
    download(fileId) {
      downloads.push(fileId);

      return Promise.resolve(bytes);
    },
  };

  const objects = recordingStorage();
  const conversations = memoryLog();

  const bot = createBot({
    token: TOKEN,
    adminId: ADMIN,
    classifier: stubIntentClassifier(),
    storage: objects.storage,
    conversations,
    files,
  });

  bot.botInfo = ME;

  bot.api.config.use((_prev, method, payload) => {
    sent.push({ method: String(method), payload: payload as Sent['payload'] });

    if (method === 'sendMessage') {
      messageId += 1;
      const text = 'text' in payload ? String(payload.text) : '';

      return Promise.resolve({
        ok: true as const,
        result: {
          message_id: messageId,
          date: 1,
          chat: { id: 7, type: 'private' as const },
          text,
        },
      } as never);
    }

    return Promise.resolve({ ok: true as const, result: true as const } as never);
  });

  return { bot, sent, downloads, bytes, ...objects, conversations };
}

function person(id: number) {
  return { id, is_bot: false, first_name: 'Kyerin' };
}

let updateId = 1;

function update(body: Record<string, unknown>): Update {
  return { update_id: updateId++, ...body };
}

describe('createBot', () => {
  it('stores each inbound kind and names the key in a reply to that message', async () => {
    const { bot, sent, downloads, bytes, uploads, keys } = harness();

    const cases = [
      {
        type: 'text',
        kind: 'document',
        message: { text: 'buy milk' },
        body: 'buy milk',
      },
      {
        type: 'url',
        kind: 'document',
        message: { text: 'https://example.com/a' },
        body: 'https://example.com/a',
      },
      {
        type: 'photo',
        kind: 'photo',
        message: {
          photo: [
            { file_id: 'small', file_unique_id: 's', width: 1, height: 1 },
            { file_id: 'big', file_unique_id: 'b', width: 10, height: 10 },
          ],
        },
        fileId: 'big',
      },
      {
        type: 'document',
        kind: 'document',
        message: {
          document: {
            file_id: 'doc',
            file_unique_id: 'd',
            file_name: 'a.pdf',
            mime_type: 'application/pdf',
          },
        },
        fileId: 'doc',
      },
      {
        type: 'voice',
        kind: 'voice',
        message: {
          voice: { file_id: 'voc', file_unique_id: 'v', duration: 1, mime_type: 'audio/ogg' },
        },
        fileId: 'voc',
      },
    ] as const;

    for (const [index, item] of cases.entries()) {
      await bot.handleUpdate(
        update({
          message: {
            message_id: 10 + index,
            date: 1_700_000_000,
            chat: { id: 7, type: 'private' },
            from: person(ADMIN),
            ...item.message,
          },
        }),
      );

      expect(uploads[index]?.kind).toBe(item.kind);
      expect(sent[index]?.payload.text).toBe(`Stored ${item.type} ${keys[index]}`);
      expect(sent[index]?.payload.reply_parameters).toEqual({ message_id: 10 + index });

      if ('body' in item) {
        expect(new TextDecoder().decode(uploads[index]?.body)).toBe(item.body);
      } else {
        expect(uploads[index]?.body).toEqual(bytes);
        expect(downloads).toContain(item.fileId);
      }
    }
  });

  it('ignores anyone who is not the admin', async () => {
    const { bot, sent, uploads } = harness();

    await bot.handleUpdate(
      update({
        message: {
          message_id: 10,
          date: 1_700_000_000,
          chat: { id: 7, type: 'private' },
          from: person(99),
          text: 'steal this',
        },
      }),
    );

    expect(sent).toEqual([]);
    expect(uploads).toEqual([]);
  });

  it('reroutes through reply_to_message and stores nothing between the two updates', async () => {
    const { bot, sent, uploads, removed, keys, conversations } = harness();

    const original = {
      message_id: 10,
      date: 1_700_000_000,
      chat: { id: 7, type: 'private' },
      from: person(ADMIN),
      text: 'buy milk',
    };

    const replies = () => sent.filter((call) => call.method === 'sendMessage');

    await bot.handleUpdate(update({ message: original }));

    const saved = replies()[0];

    expect(saved?.payload.text).toBe(`Stored text ${keys[0]}`);

    const markup = saved?.payload.reply_markup as {
      inline_keyboard: { text: string; callback_data: string }[][];
    };

    expect(markup.inline_keyboard[0]?.[0]).toEqual({ text: 'Undo', callback_data: 'undo' });

    await bot.handleUpdate(
      update({
        callback_query: {
          id: 'cb-undo',
          from: person(ADMIN),
          chat_instance: 'ci',
          data: 'undo',
          message: {
            message_id: 51,
            date: 1_700_000_001,
            chat: { id: 7, type: 'private' },
            text: saved?.payload.text,
            reply_to_message: original,
          },
        },
      }),
    );

    expect(removed).toEqual([keys[0]]);
    expect(uploads).toHaveLength(1);

    expect(replies()[1]?.payload).toMatchObject({
      text: 'not built yet',
      reply_parameters: { message_id: 10 },
    });

    expect(conversations.exchanges.map((exchange) => exchange.user.body)).toEqual([
      'buy milk',
      'undo',
    ]);

    await bot.handleUpdate(
      update({
        callback_query: {
          id: 'cb-save',
          from: person(ADMIN),
          chat_instance: 'ci',
          data: 'save',
          message: {
            message_id: 52,
            date: 1_700_000_002,
            chat: { id: 7, type: 'private' },
            text: 'not built yet',
            reply_to_message: original,
          },
        },
      }),
    );

    expect(uploads).toHaveLength(2);
    expect(replies()[2]?.payload.text).toBe(`Stored text ${keys[1]}`);
    expect(replies()[2]?.payload.reply_parameters).toEqual({ message_id: 10 });
  });

  it('answers a callback that has no original message', async () => {
    const { bot, sent } = harness();

    await bot.handleUpdate(
      update({
        callback_query: {
          id: 'cb',
          from: person(ADMIN),
          chat_instance: 'ci',
          data: 'undo',
          message: {
            message_id: 51,
            date: 1_700_000_001,
            chat: { id: 7, type: 'private' },
            text: 'Stored text documents/2026/10/11111111-1111-4111-8111-111111111111.txt',
          },
        },
      }),
    );

    expect(sent.map((call) => call.method)).toEqual(['answerCallbackQuery']);
    expect(sent[0]?.payload).toMatchObject({ text: 'Original message is gone' });
  });
});
