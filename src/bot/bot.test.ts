import type { UUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Update, UserFromGetMe } from 'grammy/types';
import { describe, expect, it } from 'vitest';
import type { AppendExchange, ConversationLog } from '../core/conversation/store.ts';
import type { ConversationTurn } from '../core/conversation/context.ts';
import type { Retrieval } from '../core/ingestion/route.ts';
import type { ChatModel } from '../core/llm/router.ts';
import { memoryId } from '../core/memory/id.ts';
import type { IngestionPipeline } from '../core/pipeline/graph.ts';
import type { IngestionInput } from '../core/pipeline/state.ts';
import type { UndoTarget } from '../core/pipeline/undo.ts';
import { NOTHING_FOUND, type Answer } from '../core/retrieval/answer.ts';
import { stubIntentClassifier, type IntentClassifier } from '../core/retrieval/intent.ts';
import type { ObjectStorage } from '../core/storage/object-storage.ts';
import type { Citation } from '../core/retrieval/answer.ts';
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

const KEY = 'documents/2026/10/11111111-1111-4111-8111-111111111111.txt';

interface Sent {
  method: string;
  payload: {
    text?: string;
    caption?: string;
    parse_mode?: string;
    reply_parameters?: { message_id?: number };
    reply_markup?: unknown;
    show_caption_above_media?: boolean;
    media?: { type: string; caption?: string }[];
  };
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

function recordingPipeline(): {
  pipeline: IngestionPipeline;
  ingested: IngestionInput[];
  undone: UndoTarget[];
} {
  const ingested: IngestionInput[] = [];
  const undone: UndoTarget[] = [];

  return {
    ingested,
    undone,
    pipeline: {
      init() {
        return Promise.resolve();
      },
      ingest(input) {
        ingested.push(input);

        return Promise.resolve({
          id: memoryId(input.source, input.message.sourceRef),
          summary: `Filed one ${input.message.type}.`,
          category: 'other' as const,
          kind: 'note' as const,
          tags: ['#inbox'],
          key: KEY,
          points: 2,
        });
      },
      undo(target) {
        undone.push(target);

        return Promise.resolve(true);
      },
    },
  };
}

const PARENT = '6b1e8a2c-9d4f-4c7a-8e1b-3a5d7c9e0f12';

function recordingRetrieval(removed = true): Retrieval & { forgotten: UUID[] } {
  const forgotten: UUID[] = [];

  return {
    forgotten,
    ask() {
      return Promise.resolve({ answer: NOTHING_FOUND, citations: [] });
    },
    recall() {
      return Promise.resolve([]);
    },
    resolveForget() {
      return Promise.resolve(undefined);
    },
    forget(parentId) {
      forgotten.push(parentId);

      return Promise.resolve(removed);
    },
  };
}

function rejectingStorage(): ObjectStorage {
  return {
    upload() {
      return Promise.reject(new Error('unused'));
    },
    presignDownload() {
      return Promise.reject(new Error('unused'));
    },
    openStream() {
      return Promise.reject(new Error('unused'));
    },
    openSized() {
      return Promise.reject(new Error('unused'));
    },
    remove() {
      return Promise.reject(new Error('unused'));
    },
  };
}

function citingRetrieval(answer: string, citations: Citation[]): Retrieval & { forgotten: UUID[] } {
  return {
    ...recordingRetrieval(),
    ask() {
      return Promise.resolve<Answer>({ answer, citations });
    },
  };
}

function cited(summary: string, key: string, type: 'photo' | 'document'): Citation {
  return { id: PARENT, summary, file: { key, type } };
}

function streamingStorage(
  sizes: ReadonlyMap<string, number>,
  destroyed: string[] = [],
): ObjectStorage {
  return {
    ...rejectingStorage(),
    openSized(key) {
      if (!sizes.has(key) && !key.includes('mystery')) {
        return Promise.reject(new Error('missing'));
      }

      // An S3 GetObject body is an IncomingMessage, which carries an empty `url`.
      const body = Object.assign(Readable.from([key]), { url: '' });
      const destroy = body.destroy.bind(body);

      body.destroy = () => {
        destroyed.push(key);

        return destroy();
      };

      const size = sizes.get(key);

      return Promise.resolve(size === undefined ? { body } : { body, size });
    },
  };
}

const phrasingFast: ChatModel = {
  id: 'fake-fast',
  complete: () => Promise.resolve('Ничего сохранённого нет.'),
  object: () => Promise.reject(new Error('unused')),
};

function harness(
  retrieval: Retrieval & { forgotten: UUID[] } = recordingRetrieval(),
  extras?: { classifier?: IntentClassifier; storage?: ObjectStorage; failHtml?: boolean },
) {
  const sent: Sent[] = [];
  let messageId = 50;

  const pipeline = recordingPipeline();
  const conversations = memoryLog();

  const bot = createBot({
    token: TOKEN,
    adminId: ADMIN,
    classifier: extras?.classifier ?? stubIntentClassifier(),
    pipeline: pipeline.pipeline,
    conversations,
    retrieval,
    fast: phrasingFast,
    storage: extras?.storage ?? rejectingStorage(),
  });

  bot.botInfo = ME;

  bot.api.config.use((_prev, method, payload) => {
    sent.push({ method: String(method), payload: payload as Sent['payload'] });

    if (extras?.failHtml === true && 'parse_mode' in payload && payload.parse_mode === 'HTML') {
      return Promise.reject(new Error('cannot parse'));
    }

    if (method === 'sendMediaGroup' && 'media' in payload && Array.isArray(payload.media)) {
      const result = payload.media.map(() => {
        messageId += 1;

        return { message_id: messageId, date: 1, chat: { id: 7, type: 'private' as const } };
      });

      return Promise.resolve({ ok: true as const, result } as never);
    }

    if (method === 'sendMessage' || method === 'sendPhoto' || method === 'sendDocument') {
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

  return { bot, sent, ...pipeline, conversations, forgotten: retrieval.forgotten };
}

function person(id: number) {
  return { id, is_bot: false, first_name: 'Kyerin' };
}

let updateId = 1;

function update(body: Record<string, unknown>): Update {
  return { update_id: updateId++, ...body };
}

const ASK = {
  classify: () => Promise.resolve({ intent: 'ask' as const, slots: { query: 'dentist' } }),
};

function askUpdate(text = 'when is the dentist'): Update {
  return update({
    message: {
      message_id: 10,
      date: 1_700_000_000,
      chat: { id: 7, type: 'private' },
      from: person(ADMIN),
      text,
    },
  });
}

describe('createBot', () => {
  it('maps each inbound kind onto the pipeline and replies to that message', async () => {
    const { bot, sent, ingested } = harness();

    const cases = [
      { type: 'text', message: { text: 'buy milk' } },
      { type: 'url', message: { text: 'https://example.com/a' } },
      {
        type: 'photo',
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

      const inbound = ingested[index]?.message;

      expect(ingested[index]?.source).toBe('telegram');
      expect(inbound?.type).toBe(item.type);
      expect(inbound?.sourceRef).toBe(String(10 + index));
      expect(sent[index]?.payload.text).toContain(`Filed one ${item.type}.`);
      expect(sent[index]?.payload.reply_parameters).toEqual({ message_id: 10 + index });

      if ('fileId' in item) {
        expect(inbound?.file?.fileId).toBe(item.fileId);
      }
    }
  });

  it('captions the first file with the answer and sends the rest as an album', async () => {
    const photo = 'photos/2026/03/dentist.jpg';
    const big = 'photos/2026/03/big.jpg';
    const pdf = 'documents/2026/03/card.pdf';
    const huge = 'documents/2026/03/huge.pdf';
    const mystery = 'documents/2026/03/mystery.pdf';
    const missing = 'documents/2026/03/gone.pdf';
    const destroyed: string[] = [];

    const sizes = new Map<string, number>([
      [photo, 12],
      [big, 11 * 1024 * 1024],
      [pdf, 20],
      [huge, 50 * 1024 * 1024 + 1],
    ]);

    const retrieval = citingRetrieval('Tuesday at 10.', [
      cited('Appointment card', photo, 'photo'),
      cited('Big card', big, 'photo'),
      cited('Insurance card', pdf, 'document'),
      cited('Archive', huge, 'document'),
      cited('Unknown size', mystery, 'document'),
      cited('Gone', missing, 'document'),
    ]);

    const { bot, sent, conversations } = harness(retrieval, {
      classifier: ASK,
      storage: streamingStorage(sizes, destroyed),
    });

    await bot.handleUpdate(askUpdate());

    expect(sent.map((item) => item.method)).toEqual([
      'sendPhoto',
      'sendMessage',
      'sendMessage',
      'sendMessage',
      'sendMediaGroup',
    ]);

    expect(sent[0]?.payload.caption).toBe('Tuesday at 10.');
    expect(sent[0]?.payload.parse_mode).toBe('HTML');
    expect(sent[0]?.payload.show_caption_above_media).toBe(true);
    expect(sent[0]?.payload.reply_parameters).toEqual({ message_id: 10 });
    expect(JSON.stringify(sent[0]?.payload.reply_markup)).toContain('save');
    expect(sent[0]?.payload.caption).not.toContain('photos/');
    expect(sent[1]?.payload.text).toBe('Archive · 51 MB, not attached');
    expect(sent[2]?.payload.text).toBe('Unknown size · not attached');
    expect(sent[3]?.payload.text).toBe('Gone · not attached');
    expect(sent[1]?.payload.reply_parameters).toEqual({ message_id: 10 });
    expect(sent[1]?.payload.reply_markup).toBeUndefined();
    expect(sent[1]?.payload.text).not.toContain('huge');

    expect(sent[4]?.payload.media?.map((item) => [item.type, item.caption])).toEqual([
      ['document', 'Big card'],
      ['document', 'Insurance card'],
    ]);

    expect(sent[4]?.payload.reply_parameters).toEqual({ message_id: 10 });
    expect(destroyed).toEqual([huge, mystery]);
    expect(conversations.exchanges[0]?.assistant.body).toBe('Tuesday at 10.');
    expect(conversations.exchanges[0]?.assistant.sourceRef).toBe('51');
  });

  it('sends one document when the answer fits its caption', async () => {
    const pdf = 'documents/2026/03/card.pdf';

    const { bot, sent } = harness(
      citingRetrieval('**Tuesday**', [cited('Insurance card', pdf, 'document')]),
      { classifier: ASK, storage: streamingStorage(new Map([[pdf, 20]])) },
    );

    await bot.handleUpdate(askUpdate());

    expect(sent.map((item) => item.method)).toEqual(['sendDocument']);
    expect(sent[0]?.payload.caption).toBe('<b>Tuesday</b>');
    expect(sent[0]?.payload.show_caption_above_media).toBeUndefined();
  });

  it('sends the text first when the answer is longer than a caption', async () => {
    const pdf = 'documents/2026/03/card.pdf';
    const answer = 'a'.repeat(1025);

    const { bot, sent, conversations } = harness(
      citingRetrieval(answer, [cited('Insurance card', pdf, 'document')]),
      { classifier: ASK, storage: streamingStorage(new Map([[pdf, 20]])) },
    );

    await bot.handleUpdate(askUpdate());

    expect(sent.map((item) => item.method)).toEqual(['sendMessage', 'sendDocument']);
    expect(sent[0]?.payload.text).toBe(answer);
    expect(JSON.stringify(sent[0]?.payload.reply_markup)).toContain('save');
    expect(sent[1]?.payload.caption).toBe('Insurance card');
    expect(sent[1]?.payload.reply_markup).toBeUndefined();
    expect(conversations.exchanges[0]?.assistant.sourceRef).toBe('51');
  });

  it('falls back to text and the file when telegram rejects the caption', async () => {
    const pdf = 'documents/2026/03/card.pdf';
    const destroyed: string[] = [];

    const { bot, sent } = harness(
      citingRetrieval('**Tuesday**', [cited('Insurance card', pdf, 'document')]),
      {
        classifier: ASK,
        storage: streamingStorage(new Map([[pdf, 20]]), destroyed),
        failHtml: true,
      },
    );

    await bot.handleUpdate(askUpdate());

    expect(sent.map((item) => item.method)).toEqual([
      'sendDocument',
      'sendMessage',
      'sendMessage',
      'sendDocument',
    ]);

    expect(sent[2]?.payload.text).toBe('**Tuesday**');
    expect(sent[3]?.payload.caption).toBe('Insurance card');
    expect(sent[3]?.payload.parse_mode).toBeUndefined();
    expect(destroyed).toEqual([pdf]);
  });

  it('reports a missing first file once and still sends the others', async () => {
    const missing = 'documents/2026/03/gone.pdf';
    const pdf = 'documents/2026/03/card.pdf';

    const { bot, sent } = harness(
      citingRetrieval('Tuesday.', [
        cited('Gone', missing, 'document'),
        cited('Insurance card', pdf, 'document'),
      ]),
      { classifier: ASK, storage: streamingStorage(new Map([[pdf, 20]])) },
    );

    await bot.handleUpdate(askUpdate());

    expect(sent.map((item) => item.method)).toEqual(['sendMessage', 'sendMessage', 'sendDocument']);
    expect(sent[0]?.payload.text).toBe('Gone · not attached');
    expect(sent[1]?.payload.text).toBe('Tuesday.');
    expect(sent[2]?.payload.caption).toBe('Insurance card');
  });

  it('keeps photos and documents in separate albums, in citation order', async () => {
    const keys = {
      a: 'photos/2026/03/a.jpg',
      b: 'documents/2026/03/b.pdf',
      c: 'photos/2026/03/c.jpg',
      d: 'documents/2026/03/d.pdf',
      e: 'photos/2026/03/e.jpg',
    };

    const { bot, sent } = harness(
      citingRetrieval('Here.', [
        cited('A', keys.a, 'photo'),
        cited('B', keys.b, 'document'),
        cited('C', keys.c, 'photo'),
        cited('D', keys.d, 'document'),
        cited('E', keys.e, 'photo'),
      ]),
      {
        classifier: ASK,
        storage: streamingStorage(new Map(Object.values(keys).map((key) => [key, 10]))),
      },
    );

    await bot.handleUpdate(askUpdate());

    expect(sent.map((item) => item.method)).toEqual([
      'sendPhoto',
      'sendMediaGroup',
      'sendMediaGroup',
    ]);

    expect(sent[0]?.payload.caption).toBe('Here.');
    expect(sent[1]?.payload.media?.map((item) => item.caption)).toEqual(['C', 'E']);
    expect(sent[2]?.payload.media?.map((item) => item.caption)).toEqual(['B', 'D']);
  });

  it('splits a long formatted reply and keeps the log as the clipped markdown', async () => {
    const retrieval = {
      ...recordingRetrieval(),
      ask() {
        return Promise.resolve<Answer>({ answer: 'a'.repeat(5000), citations: [] });
      },
    };

    const { bot, sent, conversations } = harness(retrieval, {
      classifier: {
        classify: () => Promise.resolve({ intent: 'ask', slots: { query: 'long' } }),
      },
    });

    await bot.handleUpdate(
      update({
        message: {
          message_id: 10,
          date: 1_700_000_000,
          chat: { id: 7, type: 'private' },
          from: person(ADMIN),
          text: 'long',
        },
      }),
    );

    expect(sent.map((item) => item.method)).toEqual(['sendMessage', 'sendMessage']);
    expect(sent[0]?.payload.text).toHaveLength(4096);
    expect(sent[1]?.payload.text).toHaveLength(904);
    expect(sent[0]?.payload.parse_mode).toBe('HTML');
    expect(sent[1]?.payload.parse_mode).toBe('HTML');
    expect(sent[0]?.payload.reply_markup).toBeDefined();
    expect(sent[1]?.payload.reply_markup).toBeUndefined();
    expect(sent[0]?.payload.reply_parameters).toEqual({ message_id: 10 });
    expect(sent[1]?.payload.reply_parameters).toEqual({ message_id: 10 });
    expect(conversations.exchanges[0]?.assistant.body).toHaveLength(4096);
    expect(conversations.exchanges[0]?.assistant.body).toBe('a'.repeat(4096));
    expect(conversations.exchanges[0]?.assistant.sourceRef).toBe('51');
  });

  it('sends the plain answer when telegram rejects the formatted one', async () => {
    const retrieval = {
      ...recordingRetrieval(),
      ask() {
        return Promise.resolve<Answer>({ answer: '**Tuesday**', citations: [] });
      },
    };

    const { bot, sent, conversations } = harness(retrieval, {
      classifier: {
        classify: () => Promise.resolve({ intent: 'ask', slots: { query: 'when' } }),
      },
      failHtml: true,
    });

    await bot.handleUpdate(
      update({
        message: {
          message_id: 10,
          date: 1_700_000_000,
          chat: { id: 7, type: 'private' },
          from: person(ADMIN),
          text: 'when',
        },
      }),
    );

    expect(sent.map((item) => item.method)).toEqual(['sendMessage', 'sendMessage']);
    expect(sent[0]?.payload.parse_mode).toBe('HTML');
    expect(sent[0]?.payload.text).toBe('<b>Tuesday</b>');
    expect(sent[1]?.payload.parse_mode).toBeUndefined();
    expect(sent[1]?.payload.text).toBe('**Tuesday**');
    expect(conversations.exchanges[0]?.assistant.body).toBe('**Tuesday**');
    expect(conversations.exchanges[0]?.assistant.sourceRef).toBe('51');
  });

  it('ignores anyone who is not the admin', async () => {
    const { bot, sent, ingested } = harness();

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
    expect(ingested).toEqual([]);
  });

  it('undoes by the original message id and can then save it again', async () => {
    const { bot, sent, ingested, undone, conversations } = harness();

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

    expect(saved?.payload.text).toContain('Filed one text.');

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

    expect(undone).toEqual([{ source: 'telegram', sourceRef: '10' }]);
    expect(ingested).toHaveLength(1);

    const answered = replies()[1];

    expect(answered?.payload).toMatchObject({
      text: 'Ничего сохранённого нет.',
      reply_parameters: { message_id: 10 },
    });

    const answeredMarkup = answered?.payload.reply_markup as {
      inline_keyboard: { text: string; callback_data: string }[][];
    };

    expect(answeredMarkup.inline_keyboard[0]?.[0]).toEqual({ text: 'Save', callback_data: 'save' });

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
            text: NOTHING_FOUND,
            reply_to_message: original,
          },
        },
      }),
    );

    expect(ingested).toHaveLength(2);
    expect(replies()[2]?.payload.text).toContain('Filed one text.');
    expect(replies()[2]?.payload.reply_parameters).toEqual({ message_id: 10 });
  });

  it('answers a callback that has no original message', async () => {
    const { bot, sent, undone } = harness();

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
            text: 'Saved note · other',
          },
        },
      }),
    );

    expect(sent.map((call) => call.method)).toEqual(['answerCallbackQuery']);
    expect(sent[0]?.payload).toMatchObject({ text: 'Original message is gone' });
    expect(undone).toEqual([]);
  });

  it('forgets the confirmed parent and does not ingest it', async () => {
    const retrieval = recordingRetrieval();
    const { bot, sent, ingested, forgotten, conversations } = harness(retrieval);

    await bot.handleUpdate(
      update({
        callback_query: {
          id: 'cb-forget',
          from: person(ADMIN),
          chat_instance: 'ci',
          data: `forget:${PARENT}`,
          message: {
            message_id: 51,
            date: 1_700_000_001,
            chat: { id: 7, type: 'private' },
            text: 'Forget Appointment card?',
          },
        },
      }),
    );

    expect(forgotten).toEqual([PARENT]);
    expect(ingested).toEqual([]);

    const replies = sent.filter((call) => call.method === 'sendMessage');

    expect(replies).toHaveLength(1);
    expect(replies[0]?.payload.text).toBe('Forgotten.');
    expect(replies[0]?.payload.reply_markup).toBeUndefined();
    expect(replies[0]?.payload.reply_parameters).toEqual({ message_id: 51 });
    expect(conversations.exchanges.map((exchange) => exchange.user.body)).toEqual(['forget']);
  });

  it('does not delete when the forget callback is not a parent id', async () => {
    const { bot, sent, forgotten } = harness();

    await bot.handleUpdate(
      update({
        callback_query: {
          id: 'cb-forget',
          from: person(ADMIN),
          chat_instance: 'ci',
          data: 'forget:not-a-uuid',
          message: {
            message_id: 51,
            date: 1_700_000_001,
            chat: { id: 7, type: 'private' },
            text: 'Forget Appointment card?',
          },
        },
      }),
    );

    expect(forgotten).toEqual([]);
    expect(sent.map((call) => call.method)).toEqual(['answerCallbackQuery']);
  });

  it('says nothing found when the confirmed parent is already gone', async () => {
    const { bot, sent, forgotten } = harness(recordingRetrieval(false));

    await bot.handleUpdate(
      update({
        callback_query: {
          id: 'cb-forget',
          from: person(ADMIN),
          chat_instance: 'ci',
          data: `forget:${PARENT}`,
          message: {
            message_id: 51,
            date: 1_700_000_001,
            chat: { id: 7, type: 'private' },
            text: 'Forget Appointment card?',
          },
        },
      }),
    );

    expect(forgotten).toEqual([PARENT]);

    expect(sent.filter((call) => call.method === 'sendMessage')[0]?.payload.text).toBe(
      NOTHING_FOUND,
    );
  });
});
