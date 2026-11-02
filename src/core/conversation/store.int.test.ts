import { describe, expect, it } from 'vitest';
import { withTempDatabase } from '../../test/integration.ts';
import { runMigrations } from '../db/migrate.ts';
import { createConversationLog } from './store.ts';

const CHAT = '4242';
const USER = '123456789';

const exchange = (n: number) => ({
  chatRef: CHAT,
  userRef: USER,
  displayName: 'Kirill',
  user: { body: `question ${n}`, sourceRef: `q${n}` },
  assistant: { body: `answer ${n}`, sourceRef: `a${n}` },
});

describe('conversation log', () => {
  it('appends exchanges and reads them back in order', async () => {
    await withTempDatabase(async ({ db }) => {
      await runMigrations(db);

      const log = createConversationLog(db);

      await log.append(exchange(1));
      await log.append(exchange(2));

      const turns = await log.turns(CHAT);

      expect(turns.map((turn) => [turn.role, turn.body])).toEqual([
        ['user', 'question 1'],
        ['assistant', 'answer 1'],
        ['user', 'question 2'],
        ['assistant', 'answer 2'],
      ]);

      expect(await log.turns('other-chat')).toEqual([]);
    });
  });

  it('adds the replied-to turn when it has fallen out of the recent window', async () => {
    await withTempDatabase(async ({ db }) => {
      await runMigrations(db);

      const log = createConversationLog(db);

      for (let n = 1; n <= 60; n += 1) {
        await log.append(exchange(n));
      }

      const recent = await log.turns(CHAT);

      expect(recent).toHaveLength(100);
      expect(recent[0]?.sourceRef).toBe('q11');

      const withReply = await log.turns(CHAT, 'a3');

      expect(withReply).toHaveLength(101);
      expect(withReply[0]?.sourceRef).toBe('a3');
    });
  });
});
