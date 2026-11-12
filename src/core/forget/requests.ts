import type { UUID } from 'node:crypto';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { database } from '../db/client.ts';
import { forgetRequests } from '../db/schema.ts';

export interface ForgetRequestInput {
  chatRef: string;
  memoryIds: readonly UUID[];
  userId?: UUID;
  clientId?: string;
  expiresAt?: Date;
}

/** Who may consume a request: the Telegram chat that got the button, or an MCP user on one client. */
export type ForgetScope = { chatRef: string } | { userId: UUID; clientId: string };

/** The memory ids behind one confirmation, kept until a press or a call consumes them. */
export interface ForgetRequests {
  create(input: ForgetRequestInput): Promise<UUID>;
  /** Hands out the ids once. An unknown id, another scope, a used or an expired request gives undefined. */
  take(id: UUID, scope: ForgetScope): Promise<UUID[] | undefined>;
}

function scoped(scope: ForgetScope) {
  if ('chatRef' in scope) {
    return and(
      eq(forgetRequests.chatRef, scope.chatRef),
      isNull(forgetRequests.userId),
      isNull(forgetRequests.clientId),
    );
  }

  return and(eq(forgetRequests.userId, scope.userId), eq(forgetRequests.clientId, scope.clientId));
}

export function createForgetRequests(db: Database = database()): ForgetRequests {
  return {
    async create(input) {
      const [row] = await db
        .insert(forgetRequests)
        .values({
          chatRef: input.chatRef,
          memoryIds: [...input.memoryIds],
          ...(input.userId === undefined ? {} : { userId: input.userId }),
          ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
          ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
        })
        .returning({ id: forgetRequests.id });

      if (row === undefined) {
        throw new Error('Forget request insert returned no row');
      }

      return row.id as UUID;
    },

    async take(id, scope) {
      const now = new Date();

      // One statement marks and reads, so two presses cannot both get the ids.
      const [row] = await db
        .update(forgetRequests)
        .set({ consumedAt: now })
        .where(
          and(
            eq(forgetRequests.id, id),
            isNull(forgetRequests.consumedAt),
            or(isNull(forgetRequests.expiresAt), gt(forgetRequests.expiresAt, now)),
            scoped(scope),
          ),
        )
        .returning({ memoryIds: forgetRequests.memoryIds });

      return row?.memoryIds.map((memoryId) => memoryId as UUID);
    },
  };
}
