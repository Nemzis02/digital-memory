import type { UUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationLog } from '../conversation/store.ts';
import type { ConversationTurn } from '../conversation/context.ts';
import type { AppendExchange } from '../conversation/store.ts';
import type { MemoryPayload } from '../memory/payload.ts';
import type { IngestionPipeline } from '../pipeline/graph.ts';
import type { IngestionInput } from '../pipeline/state.ts';
import { NOTHING_FOUND, type Answer } from '../retrieval/answer.ts';
import type { IntentClassifier, IntentSlots } from '../retrieval/intent.ts';
import type { InboundMessage } from './inbound.ts';
import { dispatch, forgetResult, respond, savedReply, type Retrieval } from './route.ts';

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
      { source: 'telegram', classifier: { classify }, pipeline: ingestion, retrieval },
      message('buy milk'),
      [],
      'ask',
    );

    expect(reply).toEqual({ text: NOTHING_FOUND, keyboard: 'save' });
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
          { id: PARENT, summary: 'Appointment card', url: 'https://signed.example/dentist.jpg' },
          { id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', summary: 'Weekend cooking' },
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
      },
      message('when is it'),
      [],
    );

    expect(retrieval.asks).toEqual([{ query: 'when is the dentist', categories: ['health'] }]);

    expect(reply).toEqual({
      text: 'Tuesday at 10.\n\nAppointment card\nhttps://signed.example/dentist.jpg\n\nWeekend cooking',
      keyboard: 'save',
    });
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
      },
      message('what is coming up'),
      [],
    );

    expect(reply).toEqual({ text: '2026-02-25 · Appointment card', keyboard: 'save' });

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
      },
      message('what did I save'),
      [],
    );

    expect(reply).toEqual({ text: '2023-11-14 · Appointment card', keyboard: 'save' });
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

  it('offers save when forget finds nothing', async () => {
    const retrieval = spyRetrieval();

    const reply = await respond(
      {
        source: 'telegram',
        classifier: {
          classify: () => Promise.resolve({ intent: 'forget', slots: { query: 'the dentist' } }),
        },
        pipeline: pipeline(),
        retrieval,
      },
      message('forget the dentist'),
      [],
    );

    expect(reply).toEqual({ text: NOTHING_FOUND, keyboard: 'save' });
    expect(retrieval.forgotten).toEqual([]);
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
      },
      message('long'),
      [],
    );

    expect(reply.text).toHaveLength(4096);
    expect(reply.keyboard).toBe('save');
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
