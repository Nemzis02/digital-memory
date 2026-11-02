import type { UUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { database } from '../db/client.ts';
import { forgetRequests } from '../db/schema.ts';

export interface ForgetRequestInput {
  chatRef: string;
  memoryIds: readonly UUID[];
}

/** The memory ids behind one Forget button, kept until a press consumes them. */
export interface ForgetRequests {
  create(input: ForgetRequestInput): Promise<UUID>;
  /** Hands out the ids once. An unknown id, another chat or a used request gives undefined. */
  take(id: UUID, chatRef: string): Promise<UUID[] | undefined>;
}

export function createForgetRequests(db: Database = database()): ForgetRequests {
  return {
    async create(input) {
      const [row] = await db
        .insert(forgetRequests)
        .values({ chatRef: input.chatRef, memoryIds: [...input.memoryIds] })
        .returning({ id: forgetRequests.id });

      if (row === undefined) {
        throw new Error('Forget request insert returned no row');
      }

      return row.id as UUID;
    },

    async take(id, chatRef) {
      // One statement marks and reads, so two presses cannot both get the ids.
      const [row] = await db
        .update(forgetRequests)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(forgetRequests.id, id),
            eq(forgetRequests.chatRef, chatRef),
            isNull(forgetRequests.consumedAt),
          ),
        )
        .returning({ memoryIds: forgetRequests.memoryIds });

      return row?.memoryIds.map((memoryId) => memoryId as UUID);
    },
  };
}
