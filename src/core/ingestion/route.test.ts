import { describe, expect, it, vi } from 'vitest';
import type { ConversationLog } from '../conversation/store.ts';
import type { ConversationTurn } from '../conversation/context.ts';
import type { AppendExchange } from '../conversation/store.ts';
import type { IngestionPipeline } from '../pipeline/graph.ts';
import type { IngestionInput } from '../pipeline/state.ts';
import type { InboundMessage } from './inbound.ts';
import { NOT_BUILT_YET, dispatch, respond, savedReply } from './route.ts';
import type { IntentClassifier } from '../retrieval/intent.ts';

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

    const reply = await respond(
      { source: 'telegram', classifier: { classify }, pipeline: ingestion },
      message('buy milk'),
      [],
      'ask',
    );

    expect(reply).toEqual({ text: NOT_BUILT_YET, keyboard: 'save' });
    expect(classify).not.toHaveBeenCalled();
    expect(ingestion.ingested).toEqual([]);
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
