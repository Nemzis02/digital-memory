import { describe, expect, it } from 'vitest';
import type { ConversationTurn } from '../conversation/context.ts';
import type { ChatModel, CompletionRequest, LlmRouter } from '../llm/router.ts';
import { createIntentClassifier } from './classifier.ts';
import type { ClassifiedIntent, ClassificationInput } from './intent.ts';

const NOW = new Date('2026-10-16T09:30:00Z');

function router(reply: Record<string, unknown>): LlmRouter & { requests: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];

  const model: ChatModel = {
    id: 'fake-fast',
    complete() {
      return Promise.reject(new Error('classification uses structured output'));
    },
    object(request, schema) {
      requests.push(request);

      return Promise.resolve(schema.parse(reply));
    },
  };

  return { requests, model: () => model };
}

function turn(role: ConversationTurn['role'], body: string): ConversationTurn {
  return { role, body, createdAt: NOW };
}

async function classify(
  reply: Record<string, unknown>,
  input: ClassificationInput,
): Promise<{ classified: ClassifiedIntent; request: CompletionRequest }> {
  const fake = router(reply);
  const classified = await createIntentClassifier({ router: fake, now: () => NOW }).classify(input);
  const request = fake.requests[0];

  if (request === undefined) {
    throw new Error('the classifier must call the model');
  }

  return { classified, request };
}

describe('createIntentClassifier', () => {
  it('puts today in the prompt and the current text last, after the earlier turns', async () => {
    const { request } = await classify(
      { intent: 'save' },
      {
        text: 'buy milk',
        context: [turn('user', 'dentist thursday'), turn('assistant', 'Saved.')],
      },
    );

    expect(request.system).toContain('Today is 2026-10-16.');

    expect(request.turns).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'dentist thursday' }] },
      { role: 'model', parts: [{ type: 'text', text: 'Saved.' }] },
      { role: 'user', parts: [{ type: 'text', text: 'buy milk' }] },
    ]);
  });

  it('maps an upcoming listing onto kinds, an event bound, and event order', async () => {
    const { classified } = await classify(
      {
        intent: 'recall-by-filter',
        kinds: ['event', 'task'],
        eventAfter: '2026-10-16',
        orderBy: 'event_at',
        direction: 'asc',
      },
      { text: 'what is coming up?', context: [] },
    );

    expect(classified).toEqual({
      intent: 'recall-by-filter',
      slots: {
        kinds: ['event', 'task'],
        eventAfter: Math.floor(Date.parse('2026-10-16T00:00:00Z') / 1000),
        orderBy: 'event_at',
        direction: 'asc',
      },
    });
  });

  it('keeps a rewritten query on a follow-up question', async () => {
    const { classified } = await classify(
      { intent: 'ask', query: 'when was the dentist appointment' },
      {
        text: 'when was that?',
        context: [turn('user', 'dentist on Thursday'), turn('assistant', 'Saved.')],
      },
    );

    expect(classified).toEqual({
      intent: 'ask',
      slots: { query: 'when was the dentist appointment' },
    });
  });

  it('drops slots the model filled on a save', async () => {
    const { classified } = await classify(
      {
        intent: 'save',
        query: 'buy milk',
        kinds: ['task'],
        orderBy: 'event_at',
      },
      { text: 'buy milk', context: [] },
    );

    expect(classified).toEqual({ intent: 'save', slots: {} });
  });

  it('omits a blank query and location, and slugifies tags', async () => {
    const { classified } = await classify(
      {
        intent: 'ask',
        query: '   ',
        location: '   ',
        categories: ['food'],
        kinds: [],
        tags: ['Bar Pepe', '#food', 'bar pepe', '  '],
      },
      { text: 'that tapas place', context: [] },
    );

    expect(classified).toEqual({
      intent: 'ask',
      slots: { categories: ['food'], tags: ['#bar_pepe'] },
    });
  });

  it('turns an end date into midnight UTC', async () => {
    const { classified } = await classify(
      {
        intent: 'recall-by-filter',
        eventBefore: '2026-11-03',
        createdAfter: '2026-10-01',
      },
      { text: 'appointments before November that I saved this month', context: [] },
    );

    expect(classified.slots.eventBefore).toBe(
      Math.floor(Date.parse('2026-11-03T00:00:00Z') / 1000),
    );

    expect(classified.slots.createdAfter).toBe(
      Math.floor(Date.parse('2026-10-01T00:00:00Z') / 1000),
    );
  });
});
