import type { Database } from '../db/client.ts';
import { createConversationLog } from './store.ts';
import { describe, expect, it } from 'vitest';

function scriptedDb(results: unknown[]): Database {
  const pending = [...results];

  const chain: unknown = new Proxy(function () {}, {
    get(_target, property) {
      if (property === 'then') {
        return (resolve: (value: unknown) => void) => {
          resolve(pending.shift());
        };
      }

      return () => chain;
    },
    apply() {
      return chain;
    },
  });

  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'then') {
          return undefined;
        }

        return () => chain;
      },
    },
  ) as Database;
}

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const conversationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('createConversationLog', () => {
  it('rejects a user id that is not a Telegram id before touching the database', async () => {
    const log = createConversationLog(scriptedDb([]));

    await expect(
      log.append({
        chatRef: '7',
        userRef: 'not-a-number',
        user: { body: 'hi', sourceRef: '1' },
        assistant: { body: 'yo', sourceRef: '2' },
      }),
    ).rejects.toThrow('numeric user id');
  });

  it('fails closed when an upsert returns nothing', async () => {
    const log = createConversationLog(scriptedDb([[]]));

    await expect(
      log.append({
        chatRef: '7',
        userRef: '42',
        user: { body: 'hi', sourceRef: '1' },
        assistant: { body: 'yo', sourceRef: '2' },
      }),
    ).rejects.toThrow('User upsert returned no row');
  });

  it('writes the user turn before the reply so they sort in that order', async () => {
    const log = createConversationLog(
      scriptedDb([[{ id: userId }], [{ id: conversationId }], undefined, undefined]),
    );

    await expect(
      log.append({
        chatRef: '7',
        userRef: '42',
        displayName: 'Kyerin',
        user: { body: 'buy milk', sourceRef: '10' },
        assistant: { body: 'Stored text documents/x', sourceRef: '11' },
      }),
    ).resolves.toBeUndefined();
  });

  it('returns recent turns oldest first and pulls an older reply back in', async () => {
    const older = new Date('2026-10-10T08:00:00Z');
    const recent = new Date('2026-10-10T12:00:00Z');

    const log = createConversationLog(
      scriptedDb([
        [
          { role: 'assistant', body: 'later', sourceRef: '4', createdAt: recent },
          { role: 'user', body: 'now', sourceRef: null, createdAt: new Date(recent.getTime() - 1) },
        ],
        [{ role: 'user', body: 'way earlier', sourceRef: '1', createdAt: older }],
      ]),
    );

    const turns = await log.turns('7', '1');

    expect(turns.map((turn) => turn.body)).toEqual(['way earlier', 'now', 'later']);
    expect(turns[1]).not.toHaveProperty('sourceRef');
  });

  it('does not query again when the replied-to turn is already in the window', async () => {
    const createdAt = new Date('2026-10-10T12:00:00Z');

    const log = createConversationLog(
      scriptedDb([[{ role: 'user', body: 'buy milk', sourceRef: '10', createdAt }]]),
    );

    await expect(log.turns('7', '10')).resolves.toMatchObject([
      { body: 'buy milk', sourceRef: '10' },
    ]);
  });
});
