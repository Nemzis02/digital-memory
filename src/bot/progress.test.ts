import type { Api } from 'grammy';
import type { Chat } from 'grammy/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HEARTBEAT_MS, MIN_INTERVAL_MS, progressDisplay, TYPING_MS } from './progress.ts';

const PRIVATE: Chat = { id: 7, type: 'private', first_name: 'Kyerin' };
const GROUP: Chat = { id: -7, type: 'group', title: 'Family' };

interface Call {
  method: 'sendMessageDraft' | 'sendChatAction';
  args: unknown[];
  signal: AbortSignal;
}

function fakeApi(options: { draftError?: Error; typingError?: Error; hang?: boolean } = {}) {
  const calls: Call[] = [];

  function respond(method: Call['method'], args: unknown[], error: Error | undefined) {
    const signal = args.at(-1) as AbortSignal;

    calls.push({ method, args: args.slice(0, -1), signal });

    if (options.hang === true) {
      return new Promise<true>((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason as Error), { once: true });
      });
    }

    return error === undefined ? Promise.resolve(true as const) : Promise.reject(error);
  }

  const api = {
    sendMessageDraft: (...args: unknown[]) => respond('sendMessageDraft', args, options.draftError),
    sendChatAction: (...args: unknown[]) => respond('sendChatAction', args, options.typingError),
  } as unknown as Api;

  return { api, calls };
}

function drafts(calls: Call[]): unknown[][] {
  return calls.filter((call) => call.method === 'sendMessageDraft').map((call) => call.args);
}

describe('progressDisplay', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the first stage at once as a draft keyed on the message', async () => {
    vi.useFakeTimers();

    const { api, calls } = fakeApi();
    const display = progressDisplay(api, PRIVATE, 10);

    display.report('thinking');

    expect(drafts(calls)).toStrictEqual([[7, 10, 'Thinking', undefined]]);

    await display.stop();
  });

  it('sends the latest stage once per second, and not a stage it already shows', async () => {
    vi.useFakeTimers();

    const { api, calls } = fakeApi();
    const display = progressDisplay(api, PRIVATE, 10);

    display.report('thinking');
    await vi.advanceTimersByTimeAsync(100);
    display.report('searching');
    display.report('saving');
    display.report('searching');
    await vi.advanceTimersByTimeAsync(MIN_INTERVAL_MS);

    expect(drafts(calls).map((args) => args[2])).toStrictEqual(['Thinking', 'Searching memory']);

    display.report('searching');
    await vi.advanceTimersByTimeAsync(MIN_INTERVAL_MS);

    expect(calls).toHaveLength(2);

    await display.stop();
  });

  it('resends the current draft before it expires', async () => {
    vi.useFakeTimers();

    const { api, calls } = fakeApi();
    const display = progressDisplay(api, PRIVATE, 10);

    display.report('saving');
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS - 1);

    expect(calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);

    expect(drafts(calls).map((args) => args[2])).toStrictEqual(['Saving', 'Saving']);

    await display.stop();
  });

  it('sends nothing after stop, and leaves no timer behind', async () => {
    vi.useFakeTimers();

    const { api, calls } = fakeApi();
    const display = progressDisplay(api, PRIVATE, 10);

    display.report('thinking');
    display.report('searching');

    await display.stop();
    await display.stop();

    display.report('saving');
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2);

    expect(calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a hanging send so stop does not wait for it', async () => {
    vi.useFakeTimers();

    const { api, calls } = fakeApi({ hang: true });
    const display = progressDisplay(api, PRIVATE, 10);

    display.report('thinking');

    await display.stop();

    expect(calls[0]?.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows a typing status instead when drafts fail', async () => {
    vi.useFakeTimers();

    const { api, calls } = fakeApi({ draftError: new Error('Bad Request: not a private chat') });
    const display = progressDisplay(api, PRIVATE, 10);

    display.report('thinking');
    await vi.advanceTimersByTimeAsync(0);

    expect(calls.map((call) => call.method)).toStrictEqual(['sendMessageDraft', 'sendChatAction']);
    expect(calls[1]?.args).toStrictEqual([7, 'typing', undefined]);

    display.report('searching');
    await vi.advanceTimersByTimeAsync(TYPING_MS - 1);

    expect(calls).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(1);

    expect(calls).toHaveLength(3);
    expect(calls[2]?.method).toBe('sendChatAction');

    await display.stop();
  });

  it('uses the typing status from the start outside a private chat', async () => {
    vi.useFakeTimers();

    const { api, calls } = fakeApi();
    const display = progressDisplay(api, GROUP, 10);

    display.report('thinking');
    await vi.advanceTimersByTimeAsync(TYPING_MS);

    expect(calls.map((call) => call.method)).toStrictEqual(['sendChatAction', 'sendChatAction']);
    expect(calls[0]?.args).toStrictEqual([-7, 'typing', undefined]);

    await display.stop();
  });

  it('gives up for the turn when the typing status fails too', async () => {
    vi.useFakeTimers();

    const { api, calls } = fakeApi({ typingError: new Error('Forbidden: bot was blocked') });
    const display = progressDisplay(api, GROUP, 10);

    display.report('thinking');
    await vi.advanceTimersByTimeAsync(TYPING_MS * 3);

    expect(calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);

    await display.stop();
  });
});
