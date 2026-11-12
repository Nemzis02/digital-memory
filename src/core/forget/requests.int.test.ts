import type { UUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { withTempDatabase } from '../../test/integration.ts';
import { runMigrations } from '../db/migrate.ts';
import { upsertUser } from '../db/users.ts';
import { createForgetRequests } from './requests.ts';

const CHAT = '4242';
const CLIENT = 'https://client.example/metadata.json';
const FIRST: UUID = '6b1e8a2c-9d4f-4c7a-8e1b-3a5d7c9e0f12';
const SECOND: UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const minutes = (count: number) => new Date(Date.now() + count * 60_000);

describe('forget requests', () => {
  it('hands out the ids once, to the chat that asked', async () => {
    await withTempDatabase(async ({ db }) => {
      await runMigrations(db);

      const requests = createForgetRequests(db);
      const id = await requests.take('7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f', { chatRef: CHAT });

      expect(id).toBeUndefined();

      const requestId = await requests.create({ chatRef: CHAT, memoryIds: [FIRST, SECOND] });

      expect(await requests.take(requestId, { chatRef: 'other-chat' })).toBeUndefined();
      expect(await requests.take(requestId, { chatRef: CHAT })).toEqual([FIRST, SECOND]);
      expect(await requests.take(requestId, { chatRef: CHAT })).toBeUndefined();
    });
  });

  it('hands an MCP request only to its user on its client, before it expires', async () => {
    await withTempDatabase(async ({ db }) => {
      await runMigrations(db);

      const requests = createForgetRequests(db);
      const userId = await upsertUser(db, 123456789);
      const otherUser = await upsertUser(db, 987654321);

      const requestId = await requests.create({
        chatRef: CLIENT,
        memoryIds: [FIRST],
        userId,
        clientId: CLIENT,
        expiresAt: minutes(5),
      });

      expect(await requests.take(requestId, { chatRef: CLIENT })).toBeUndefined();
      expect(await requests.take(requestId, { userId, clientId: 'other-client' })).toBeUndefined();

      expect(
        await requests.take(requestId, { userId: otherUser, clientId: CLIENT }),
      ).toBeUndefined();

      expect(await requests.take(requestId, { userId, clientId: CLIENT })).toEqual([FIRST]);
      expect(await requests.take(requestId, { userId, clientId: CLIENT })).toBeUndefined();

      const expired = await requests.create({
        chatRef: CLIENT,
        memoryIds: [SECOND],
        userId,
        clientId: CLIENT,
        expiresAt: minutes(-1),
      });

      expect(await requests.take(expired, { userId, clientId: CLIENT })).toBeUndefined();
    });
  });
});
