import { describe, expect, it, vi } from 'vitest';
import type { ConversationLog } from '../conversation/store.ts';
import type { ConversationTurn } from '../conversation/context.ts';
import type { AppendExchange } from '../conversation/store.ts';
import type { InboundMessage } from './inbound.ts';
import { NOT_BUILT_YET, dispatch, respond } from './route.ts';
import type { IntentClassifier } from '../retrieval/intent.ts';
import type { ObjectStorage } from '../storage/object-storage.ts';

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

function storage(): ObjectStorage & { keys: string[] } {
  const keys: string[] = [];

  return {
    keys,
    async upload(input) {
      const key = `documents/2026/10/11111111-1111-4111-8111-11111111111${keys.length}.txt`;

      keys.push(key);

      return { key, size: input.body.byteLength, contentType: 'text/plain' };
    },
    async presignDownload() {
      return 'signed';
    },
    async openStream() {
      throw new Error('unused');
    },
    async remove() {
      return undefined;
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
    const files = { download: vi.fn() };
    const objects = storage();

    const reply = await respond(
      { classifier: { classify }, files, storage: objects },
      message('buy milk'),
      [],
      'ask',
    );

    expect(reply).toEqual({ text: NOT_BUILT_YET, keyboard: 'save' });
    expect(classify).not.toHaveBeenCalled();
    expect(objects.keys).toEqual([]);
  });
});

describe('dispatch', () => {
  it('shows the classifier the recent window and records both turns', async () => {
    const seen: string[] = [];

    const classifier: IntentClassifier = {
      async classify(input) {
        seen.push(...input.context.map((turn) => turn.body));

        return { intent: 'save' };
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

    const objects = storage();
    const sent: string[] = [];

    const reply = await dispatch(
      {
        classifier,
        files: { download: vi.fn() },
        storage: objects,
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
    expect(reply.text).toContain(objects.keys[0]);
    expect(sent).toEqual([reply.text]);

    expect(conversations.exchanges[0]).toMatchObject({
      user: { body: 'buy milk', sourceRef: '10' },
      assistant: { body: reply.text, sourceRef: '11' },
    });
  });
});
