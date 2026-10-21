import type { UUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationLog } from '../conversation/store.ts';
import type { ConversationTurn } from '../conversation/context.ts';
import type { AppendExchange } from '../conversation/store.ts';
import type { ChatModel } from '../llm/router.ts';
import type { MemoryPayload } from '../memory/payload.ts';
import type { IngestionPipeline } from '../pipeline/graph.ts';
import type { IngestionInput } from '../pipeline/state.ts';
import { NOTHING_FOUND, type Answer } from '../retrieval/answer.ts';
import type { IntentClassifier, IntentSlots } from '../retrieval/intent.ts';
import type { InboundMessage } from './inbound.ts';
import { savedReply } from './reply.ts';
import { dispatch, forgetResult, respond, type Retrieval } from './route.ts';

function fastModel(reply: string): ChatModel & { asked: string[] } {
  const asked: string[] = [];

  return {
    asked,
    id: 'fake-fast',
    complete(request) {
      const part = request.turns[0]?.parts[0];

      asked.push(part?.type === 'text' ? part.text : '');

      return Promise.resolve(reply);
    },
    object() {
      return Promise.reject(new Error('unused'));
    },
    run() {
      return Promise.reject(new Error('unused'));
    },
  };
}

const quietFast = fastModel('unused');

function message(text: string, replyToSourceRef?: string): InboundMessage {
  return {
    sourceRef: '10',
    chatRef: '7',
    userRef: '42',
    displayName: 'Kyerin',
    type: 'text',
    text,
    ...(replyToSourceRef === undefined ? {} : { replyToSourceRef }),
  };
}

const KEY = 'documents/2026/10/11111111-1111-4111-8111-111111111111.txt';

function pipeline(): IngestionPipeline & { ingested: IngestionInput[] } {
  const ingested: IngestionInput[] = [];

  return {
    ingested,
    async init() {
      return undefined;
    },
    async ingest(input) {
      ingested.push(input);

      return {
        id: '22222222-2222-4222-8222-222222222222',
        summary: 'Milk on the shopping list.',
        category: 'shopping',
        kind: 'task',
        tags: ['#groceries'],
        key: KEY,
        points: 2,
      };
    },
    async undo() {
      return true;
    },
  };
}

const PARENT = '6b1e8a2c-9d4f-4c7a-8e1b-3a5d7c9e0f12';

const dentist: MemoryPayload = {
  id: PARENT,
  source: 'telegram',
  source_ref: 'dentist',
  type: 'text',
  original_text: 'dentist Tuesday at 10',
  summary: 'Appointment card',
  metadata: { category: 'health', kind: 'event', tags: [] },
  chunking: { is_child: false },
  created_at: 1_700_000_000,
  event_at: 1_772_000_000,
};

function spyRetrieval(options?: {
  answer?: Answer;
  memories?: MemoryPayload[];
  parent?: MemoryPayload;
  removed?: boolean;
}): Retrieval & {
  asks: IntentSlots[];
  recalls: IntentSlots[];
  resolved: IntentSlots[];
  forgotten: UUID[];
} {
  const asks: IntentSlots[] = [];
  const recalls: IntentSlots[] = [];
  const resolved: IntentSlots[] = [];
  const forgotten: UUID[] = [];

  return {
    asks,
    recalls,
    resolved,
    forgotten,
    ask(slots) {
      asks.push(slots);

      return Promise.resolve(options?.answer ?? { answer: NOTHING_FOUND, citations: [] });
    },
    recall(slots) {
      recalls.push(slots);

      return Promise.resolve(options?.memories ?? []);
    },
    resolveForget(slots) {
      resolved.push(slots);

      return Promise.resolve(options?.parent);
    },
    forget(parentId) {
      forgotten.push(parentId);

      return Promise.resolve(options?.removed ?? true);
    },
  };
}

function log(): ConversationLog & { exchanges: AppendExchange[] } {
  const history: ConversationTurn[] = [];
  const exchanges: AppendExchange[] = [];

  return {
    exchanges,
    async turns() {
      return history;
    },
    async append(exchange) {
      exchanges.push(exchange);
      const createdAt = new Date('2026-10-10T12:00:00Z');

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
    },
  };
}

describe('respond', () => {
  it('does not call the classifier when the button already picked the intent', async () => {
    const classify = vi.fn();
    const ingestion = pipeline();
    const retrieval = spyRetrieval();

    const reply = await respond(
      {
        source: 'telegram',
        classifier: { classify },
        pipeline: ingestion,
        retrieval,
        fast: fastModel('Ничего сохранённого нет.'),
      },
      message('buy milk'),
      [],
      'ask',
    );

    expect(reply).toEqual({
      text: 'Ничего сохранённого нет.',
      html: 'Ничего сохранённого нет.',
      keyboard: 'none',
    });

    expect(classify).not.toHaveBeenCalled();
    expect(ingestion.ingested).toEqual([]);
    expect(retrieval.asks).toEqual([{ query: 'buy milk' }]);
    expect(retrieval.forgotten).toEqual([]);
  });

  it('asks with the classifier query and cites the file', async () => {
    const retrieval = spyRetrieval({
      answer: {
        answer: 'Tuesday at 10.',
        citations: [
          {
            id: PARENT,
            summary: 'Appointment card',
            file: { key: 'photos/2026/03/dentist.jpg', type: 'photo' },
          },
          {
            id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
            summary: 'Paella page',
            url: 'https://example.com/paella',
          },
        ],
      },
    });

    const reply = await respond(
      {
        source: 'telegram',
        classifier: {
          classify: () =>
            Promise.resolve({
              intent: 'ask',
              slots: { query: '  when is the dentist  ', categories: ['health'] },
            }),
        },
        pipeline: pipeline(),
        retrieval,
        fast: quietFast,
      },
      message('when is it'),
      [],
    );

    expect(retrieval.asks).toEqual([{ query: 'when is the dentist', categories: ['health'] }]);

    expect(reply).toEqual({
      text: 'Tuesday at 10.\n\nPaella page',
      html: 'Tuesday at 10.\n\n<a href="https://example.com/paella">Paella page</a>',
      files: [{ key: 'photos/2026/03/dentist.jpg', type: 'photo', summary: 'Appointment card' }],
      keyboard: 'none',
    });

    expect(reply.text).not.toContain('photos/');
  });

  it('renders markdown as telegram html and keeps the log as markdown', async () => {
    const retrieval = spyRetrieval({
      answer: {
        answer: '**Tuesday** at 10.\n\n- card',
        citations: [],
      },
    });

    const reply = await respond(
      {
        source: 'telegram',
        classifier: {
          classify: () => Promise.resolve({ intent: 'ask', slots: { query: 'when' } }),
        },
        pipeline: pipeline(),
        retrieval,
        fast: quietFast,
      },
      message('when'),
      [],
    );

    expect(reply.text).toBe('**Tuesday** at 10.\n\n- card');
    expect(reply.html).toBe('<b>Tuesday</b> at 10.\n\n• card');
  });

  it('escapes the answer and the summary inside the link', async () => {
    const retrieval = spyRetrieval({
      answer: {
        answer: 'a < b & c',
        citations: [
          {
            id: PARENT,
            summary: 'card</a><a href="https://evil.example">',
            url: 'https://signed.example/a.jpg?q="1"',
          },
        ],
      },
    });

    const reply = await respond(
      {
        source: 'telegram',
        classifier: {
          classify: () => Promise.resolve({ intent: 'ask', slots: { query: 'card' } }),
        },
        pipeline: pipeline(),
        retrieval,
        fast: quietFast,
      },
      message('card'),
      [],
    );

    expect(reply.text).toBe('a < b & c\n\ncard</a><a href="https://evil.example">');
    expect(reply.text).not.toContain('signed.example');

    expect(reply).toMatchObject({
      keyboard: 'none',
      html: [
        'a &lt; b &amp; c',
        '',
        '<a href="https://signed.example/a.jpg?q=&quot;1&quot;">card&lt;/a&gt;&lt;a href="https://evil.example"&gt;</a>',
      ].join('\n'),
    });
  });

  it('sends plain text when the linked form exceeds the telegram limit', async () => {
    const retrieval = spyRetrieval({
      answer: {
        answer: 'Tuesday.',
        citations: [
          {
            id: PARENT,
            summary: 'Appointment card',
            url: `https://signed.example/${'a'.repeat(5000)}`,
          },
          {
            id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
            summary: 'Scan',
            file: { key: 'documents/2026/03/scan.pdf', type: 'document', name: 'Escaneo.pdf' },
          },
        ],
      },
    });

    const reply = await respond(
      {
        source: 'telegram',
        classifier: {
          classify: () => Promise.resolve({ intent: 'ask', slots: { query: 'when' } }),
        },
        pipeline: pipeline(),
        retrieval,
        fast: quietFast,
      },
      message('when'),
      [],
    );

    expect(reply.text).toBe('Tuesday.\n\nAppointment card');
    expect(reply.html).toContain('<a href="https://signed.example/');
    expect(reply.html?.length).toBeGreaterThan(4096);

    expect(reply).toMatchObject({
      files: [
        {
          key: 'documents/2026/03/scan.pdf',
          type: 'document',
          name: 'Escaneo.pdf',
          summary: 'Scan',
        },
      ],
      keyboard: 'none',
    });
  });

  it('answers a greeting in the language of the message', async () => {
    const retrieval = spyRetrieval();
    const fast = fastModel('Нормально. Спрашивай, что сохранено.');

    const reply = await respond(
      {
        source: 'telegram',
        classifier: {
          classify: () => Promise.resolve({ intent: 'chat', slots: { query: 'Привет' } }),
        },
        pipeline: pipeline(),
        retrieval,
        fast,
      },
      message('Привет'),
      [],
    );

    expect(reply).toEqual({ text: 'Нормально. Спрашивай, что сохранено.', keyboard: 'none' });
    expect(fast.asked).toEqual(['Привет']);
    expect(retrieval.asks).toEqual([]);
    expect(retrieval.recalls).toEqual([]);
    expect(retrieval.resolved).toEqual([]);
    expect(retrieval.forgotten).toEqual([]);
  });

  it('keeps the english line when a greeting cannot be phrased', async () => {
    const retrieval = spyRetrieval();

    const reply = await respond(
      {
        source: 'telegram',
        classifier: {
          classify: () => Promise.resolve({ intent: 'chat', slots: { query: 'Привет' } }),
        },
        pipeline: pipeline(),
        retrieval,
        fast: {
          id: 'fake-fast',
          complete: () => Promise.reject(new Error('down')),
          object: () => Promise.reject(new Error('unused')),
          run: () => Promise.reject(new Error('unused')),
        },
      },
      message('Привет'),
      [],
    );

    expect(reply).toEqual({ text: "Ask me about something you've saved.", keyboard: 'none' });
    expect(retrieval.asks).toEqual([]);
  });

  it('uses the message text when ask or forget has no query', async () => {
    const retrieval = spyRetrieval({ parent: dentist });

    await respond(
      {
        source: 'telegram',
        classifier: {
          classify: () => Promise.resolve({ intent: 'forget', slots: { query: '   ' } }),
        },
        pipeline: pipeline(),
        retrieval,
        fast: quietFast,
      },
      message('forget the dentist'),
      [],
    );

    expect(retrieval.resolved).toEqual([{ query: 'forget the dentist' }]);
    expect(retrieval.forgotten).toEqual([]);
  });

  it('lists dated parents and does not search', async () => {
    const retrieval = spyRetrieval({ memories: [dentist] });

    const reply = await respond(
      {
        source: 'telegram',
        classifier: {
          classify: () =>
            Promise.resolve({
              intent: 'recall-by-filter',
              slots: { kinds: ['event'], orderBy: 'event_at', direction: 'asc' },
            }),
        },
        pipeline: pipeline(),
        retrieval,
        fast: quietFast,
      },
      message('what is coming up'),
      [],
    );

    expect(reply).toEqual({ text: '2026-02-25 · Appointment card', keyboard: 'none' });

    expect(retrieval.recalls).toEqual([
      { kinds: ['event'], orderBy: 'event_at', direction: 'asc' },
    ]);

    expect(retrieval.asks).toEqual([]);
    expect(retrieval.resolved).toEqual([]);
  });

  it('dates a created listing from created_at', async () => {
    const retrieval = spyRetrieval({ memories: [dentist] });

    const reply = await respond(
      {
        source: 'telegram',
        classifier: {
          classify: () =>
            Promise.resolve({ intent: 'recall-by-filter', slots: { orderBy: 'created_at' } }),
        },
        pipeline: pipeline(),
        retrieval,
        fast: quietFast,
      },
      message('what did I save'),
      [],
    );

    expect(reply).toEqual({ text: '2023-11-14 · Appointment card', keyboard: 'none' });
  });

  it('asks to confirm a forget and does not delete yet', async () => {
    const retrieval = spyRetrieval({ parent: dentist });

    const reply = await respond(
      {
        source: 'telegram',
        classifier: {
          classify: () => Promise.resolve({ intent: 'forget', slots: { query: 'the dentist' } }),
        },
        pipeline: pipeline(),
        retrieval,
        fast: quietFast,
      },
      message('forget the dentist'),
      [],
    );

    expect(reply).toEqual({
      text: 'Forget Appointment card?',
      keyboard: 'forget',
      parentId: PARENT,
    });

    expect(retrieval.forgotten).toEqual([]);
  });

  it('phrases a forget that finds nothing in the user language', async () => {
    const retrieval = spyRetrieval();
    const fast = fastModel('Ничего про стоматолога нет.');

    const reply = await respond(
      {
        source: 'telegram',
        classifier: {
          classify: () => Promise.resolve({ intent: 'forget', slots: { query: 'the dentist' } }),
        },
        pipeline: pipeline(),
        retrieval,
        fast,
      },
      message('забудь стоматолога'),
      [],
    );

    expect(reply).toEqual({ text: 'Ничего про стоматолога нет.', keyboard: 'none' });
    expect(fast.asked).toEqual(['забудь стоматолога']);
    expect(retrieval.forgotten).toEqual([]);
  });

  it('phrases an empty listing in the user language', async () => {
    const retrieval = spyRetrieval();
    const fast = fastModel('Ничего сохранённого нет.');

    const reply = await respond(
      {
        source: 'telegram',
        classifier: {
          classify: () =>
            Promise.resolve({ intent: 'recall-by-filter', slots: { orderBy: 'created_at' } }),
        },
        pipeline: pipeline(),
        retrieval,
        fast,
      },
      message('что у меня по Валенсии'),
      [],
    );

    expect(reply).toEqual({ text: 'Ничего сохранённого нет.', keyboard: 'none' });
    expect(fast.asked).toEqual(['что у меня по Валенсии']);
    expect(retrieval.asks).toEqual([]);
  });

  it('clips a reply at the telegram limit', async () => {
    const retrieval = spyRetrieval({ answer: { answer: 'a'.repeat(5000), citations: [] } });

    const reply = await respond(
      {
        source: 'telegram',
        classifier: {
          classify: () => Promise.resolve({ intent: 'ask', slots: { query: 'long' } }),
        },
        pipeline: pipeline(),
        retrieval,
        fast: quietFast,
      },
      message('long'),
      [],
    );

    expect(reply.text).toHaveLength(4096);
    expect(reply.html).toHaveLength(5000);
    expect(reply.keyboard).toBe('none');
  });
});

describe('forgetResult', () => {
  it('reports the delete without a button', () => {
    expect(forgetResult(true)).toEqual({ text: 'Forgotten.', keyboard: 'none' });
    expect(forgetResult(false)).toEqual({ text: NOTHING_FOUND, keyboard: 'none' });
  });
});

describe('savedReply', () => {
  it('leads with the kind and category, then the summary and the tags', () => {
    const text = savedReply({
      id: '22222222-2222-4222-8222-222222222222',
      summary: 'Tapas at Bar Pepe.',
      category: 'food',
      kind: 'recommendation',
      tags: ['#tapas', '#valencia'],
      key: KEY,
      points: 2,
    });

    expect(text).toBe('Saved recommendation · food\nTapas at Bar Pepe.\n#tapas #valencia');
  });

  it('omits the tag line when nothing was tagged', () => {
    const text = savedReply({
      id: '22222222-2222-4222-8222-222222222222',
      summary: 'A note.',
      category: 'other',
      kind: 'note',
      tags: [],
      key: KEY,
      points: 2,
    });

    expect(text).toBe('Saved note · other\nA note.');
  });
});

describe('dispatch', () => {
  it('shows the classifier the recent window and records both turns', async () => {
    const seen: string[] = [];

    const classifier: IntentClassifier = {
      async classify(input) {
        seen.push(...input.context.map((turn) => turn.body));

        return { intent: 'save', slots: {} };
      },
    };

    const conversations = log();
    const now = new Date('2026-10-10T12:01:00Z');

    await conversations.append({
      chatRef: '7',
      userRef: '42',
      user: { body: 'old topic', sourceRef: '1' },
      assistant: { body: 'old reply', sourceRef: '2' },
    });

    conversations.exchanges.length = 0;

    const ingestion = pipeline();
    const sent: string[] = [];

    const reply = await dispatch(
      {
        source: 'telegram',
        classifier,
        pipeline: ingestion,
        conversations,
        retrieval: spyRetrieval(),
        fast: quietFast,
        now: () => now,
      },
      message('buy milk', '1'),
      async (outgoing) => {
        sent.push(outgoing.text);

        return '11';
      },
    );

    expect(seen).toEqual(['old topic', 'old reply']);
    expect(reply.keyboard).toBe('undo');
    expect(reply.text).toContain('Milk on the shopping list.');
    expect(ingestion.ingested).toEqual([{ source: 'telegram', message: message('buy milk', '1') }]);
    expect(sent).toEqual([reply.text]);

    expect(conversations.exchanges[0]).toMatchObject({
      user: { body: 'buy milk', sourceRef: '10' },
      assistant: { body: reply.text, sourceRef: '11' },
    });
  });
});
