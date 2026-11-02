import type { UUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { withTempDatabase } from '../../test/integration.ts';
import { runMigrations } from '../db/migrate.ts';
import { createForgetRequests } from './requests.ts';

const CHAT = '4242';
const FIRST: UUID = '6b1e8a2c-9d4f-4c7a-8e1b-3a5d7c9e0f12';
const SECOND: UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('forget requests', () => {
  it('hands out the ids once, to the chat that asked', async () => {
    await withTempDatabase(async ({ db }) => {
      await runMigrations(db);

      const requests = createForgetRequests(db);
      const id = await requests.take('7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f', CHAT);

      expect(id).toBeUndefined();

      const requestId = await requests.create({ chatRef: CHAT, memoryIds: [FIRST, SECOND] });

      expect(await requests.take(requestId, 'other-chat')).toBeUndefined();
      expect(await requests.take(requestId, CHAT)).toEqual([FIRST, SECOND]);
      expect(await requests.take(requestId, CHAT)).toBeUndefined();
    });
  });
});
