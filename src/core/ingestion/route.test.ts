import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TurnOptions } from '../agent/turn.ts';
import type { ConversationLog } from '../conversation/store.ts';
import type { ConversationTurn } from '../conversation/context.ts';
import type { AppendExchange } from '../conversation/store.ts';
import type { ForgetRequestInput, ForgetRequests } from '../forget/requests.ts';
import type { IngestionPipeline } from '../pipeline/graph.ts';
import type { IngestionInput } from '../pipeline/state.ts';
import { NOTHING_FOUND } from '../retrieval/answer.ts';
import type { TurnIdentity, TurnOutcome } from '../telemetry/attributes.ts';
import type { InboundMessage } from './inbound.ts';
import type { RouteReply, TurnReply } from './reply.ts';
import { dispatch, forgetResult, type RouteDeps } from './route.ts';

const PARENT = '6b1e8a2c-9d4f-4c7a-8e1b-3a5d7c9e0f12';
const REQUEST = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';

function requests(): ForgetRequests & { created: ForgetRequestInput[] } {
  const created: ForgetRequestInput[] = [];

  return {
    created,
    async create(input) {
      created.push(input);

      return REQUEST;
    },
    async take() {
      return undefined;
    },
  };
}

const traced = vi.hoisted(() => ({
  turns: [] as { identity: TurnIdentity; outcomes: TurnOutcome[] }[],
}));

vi.mock('../telemetry/telemetry.ts', () => ({
  traceTurn: async (
    identity: TurnIdentity,
    run: (setOutcome: (outcome: TurnOutcome) => void) => Promise<unknown>,
  ) => {
    const outcomes: TurnOutcome[] = [];

    traced.turns.push({ identity, outcomes });

    return run((outcome) => outcomes.push(outcome));
  },
}));

afterEach(() => {
  traced.turns.length = 0;
});

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

function photo(caption = ''): InboundMessage {
  return { ...message(caption), type: 'photo', file: { fileId: 'file-1' } };
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

interface TurnCall {
  message: InboundMessage;
  context: string[];
  options?: TurnOptions;
}

const ANSWER: TurnReply = { text: 'Tuesday at 10.', keyboard: 'none' };

async function harness(reply: TurnReply = ANSWER) {
  const conversations = log();
  const pending = requests();

  await conversations.append({
    chatRef: '7',
    userRef: '42',
    user: { body: 'old topic', sourceRef: '1' },
    assistant: { body: 'old reply', sourceRef: '2' },
  });

  conversations.exchanges.length = 0;

  const ingestion = pipeline();
  const turns: TurnCall[] = [];
  const sent: string[] = [];

  const deps: RouteDeps = {
    source: 'telegram',
    pipeline: ingestion,
    conversations,
    turn(inbound, context, options) {
      turns.push({
        message: inbound,
        context: context.map((turn) => turn.body),
        ...(options === undefined ? {} : { options }),
      });

      return Promise.resolve(reply);
    },
    forgetRequests: pending,
    forget: () => Promise.reject(new Error('unused')),
    now: () => new Date('2026-10-10T12:01:00Z'),
  };

  const send = async (outgoing: RouteReply) => {
    sent.push(outgoing.text);

    return '11';
  };

  return { deps, send, conversations, ingested: ingestion.ingested, turns, sent, pending };
}

describe('forgetResult', () => {
  it('reports the delete without a button, counting when more than one was asked', () => {
    expect(forgetResult(1, 1)).toEqual({ text: 'Forgotten.', keyboard: 'none' });
    expect(forgetResult(0, 1)).toEqual({ text: NOTHING_FOUND, keyboard: 'none' });
    expect(forgetResult(2, 2)).toEqual({ text: 'Forgotten 2 memories.', keyboard: 'none' });
    expect(forgetResult(0, 2)).toEqual({ text: NOTHING_FOUND, keyboard: 'none' });

    expect(forgetResult(1, 3)).toEqual({
      text: 'Forgotten 1 of 3 memories. The others were already gone.',
      keyboard: 'none',
    });
  });
});

describe('dispatch of a forget proposal', () => {
  const text = 'Forget this memory?\n2026-10-02 · Appointment card';

  it('stores the proposed ids and hands the bot the request id', async () => {
    const box = await harness({
      text,
      keyboard: 'forget',
      candidates: [{ id: PARENT, summary: 'Appointment card', createdAt: '2026-10-02' }],
    });

    const reply = await dispatch(box.deps, message('forget the dentist card'), box.send);

    expect(reply).toStrictEqual({ text, keyboard: 'forget', requestId: REQUEST });
    expect(box.pending.created).toStrictEqual([{ chatRef: '7', memoryIds: [PARENT] }]);
    expect(box.sent).toStrictEqual([text]);
    expect(box.conversations.exchanges.map((exchange) => exchange.assistant.body)).toEqual([text]);
  });
});

describe('dispatch', () => {
  it('hands the turn the recent window and records both sides of the exchange', async () => {
    const box = await harness();
    const inbound = message('when is the dentist', '1');

    const reply = await dispatch(box.deps, inbound, box.send);

    expect(reply).toBe(ANSWER);
    expect(box.turns).toStrictEqual([{ message: inbound, context: ['old topic', 'old reply'] }]);
    expect(box.ingested).toStrictEqual([]);
    expect(box.sent).toStrictEqual(['Tuesday at 10.']);

    expect(box.conversations.exchanges[0]).toMatchObject({
      user: { body: 'when is the dentist', sourceRef: '10' },
      assistant: { body: 'Tuesday at 10.', sourceRef: '11' },
    });
  });

  it('saves a captionless file with Undo and runs no turn', async () => {
    const box = await harness();

    const reply = await dispatch(box.deps, photo('   '), box.send);

    expect(reply).toStrictEqual({
      text: 'Saved task · shopping\nMilk on the shopping list.\n#groceries',
      keyboard: 'undo',
    });

    expect(box.ingested).toStrictEqual([{ source: 'telegram', message: photo('   ') }]);
    expect(box.turns).toStrictEqual([]);
    expect(box.conversations.exchanges[0]?.user.body).toBe('[photo]');

    expect(traced.turns).toStrictEqual([
      { identity: { source: 'telegram', chatRef: '7', userRef: '42' }, outcomes: ['saved'] },
    ]);
  });

  it('runs a captioned file through the turn', async () => {
    const box = await harness();

    await dispatch(box.deps, photo('the dentist card'), box.send);

    expect(box.turns).toHaveLength(1);
    expect(box.ingested).toStrictEqual([]);
  });

  it('re-runs the turn with saving off after Undo, recording the button press', async () => {
    const box = await harness();

    await dispatch(box.deps, message('buy milk'), box.send, {
      saving: false,
      userTurn: { body: 'undo', sourceRef: 'cb-1' },
    });

    expect(box.turns).toStrictEqual([
      {
        message: message('buy milk'),
        context: ['old topic', 'old reply'],
        options: { saving: false },
      },
    ]);

    expect(box.conversations.exchanges[0]?.user).toStrictEqual({ body: 'undo', sourceRef: 'cb-1' });
  });

  it('neither saves nor runs a turn when Undo lands on a captionless file', async () => {
    const box = await harness();

    const reply = await dispatch(box.deps, photo(), box.send, { saving: false });

    expect(reply).toStrictEqual({ text: 'Not kept.', keyboard: 'none' });
    expect(box.ingested).toStrictEqual([]);
    expect(box.turns).toStrictEqual([]);
  });

  it('still returns the reply when the exchange cannot be recorded', async () => {
    const box = await harness();

    box.deps.conversations.append = () => Promise.reject(new Error('db down'));

    await expect(dispatch(box.deps, message('hi'), box.send)).resolves.toBe(ANSWER);
  });
});
