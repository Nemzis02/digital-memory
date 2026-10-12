import { and, asc, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { database } from '../db/client.ts';
import { conversationTurns, conversations, users } from '../db/schema.ts';
import type { ConversationTurn } from './context.ts';

export interface ExchangeTurn {
  body: string;
  sourceRef: string;
}

export interface AppendExchange {
  chatRef: string;
  userRef: string;
  displayName?: string;
  user: ExchangeTurn;
  assistant: ExchangeTurn;
}

export interface ConversationLog {
  turns(chatRef: string, replyToSourceRef?: string): Promise<ConversationTurn[]>;
  append(exchange: AppendExchange): Promise<void>;
}

const RECENT_TURN_LIMIT = 100;

function telegramId(userRef: string): number {
  if (!/^\d+$/.test(userRef)) {
    throw new Error('A Telegram conversation requires a numeric user id');
  }

  return Number(userRef);
}

function toTurn(row: {
  role: 'user' | 'assistant';
  body: string;
  sourceRef: string | null;
  createdAt: Date;
}): ConversationTurn {
  return {
    role: row.role,
    body: row.body,
    createdAt: row.createdAt,
    ...(row.sourceRef === null ? {} : { sourceRef: row.sourceRef }),
  };
}

export function createConversationLog(db: Database = database()): ConversationLog {
  const selectTurns = (chatRef: string, sourceRef?: string) => {
    const filters = [eq(conversations.source, 'telegram'), eq(conversations.externalId, chatRef)];

    return db
      .select({
        role: conversationTurns.role,
        body: conversationTurns.body,
        sourceRef: conversationTurns.sourceRef,
        createdAt: conversationTurns.createdAt,
      })
      .from(conversationTurns)
      .innerJoin(conversations, eq(conversationTurns.conversationId, conversations.id))
      .where(
        sourceRef === undefined
          ? and(...filters)
          : and(...filters, eq(conversationTurns.sourceRef, sourceRef)),
      );
  };

  return {
    async turns(chatRef, replyToSourceRef) {
      const recent = await selectTurns(chatRef)
        .orderBy(desc(conversationTurns.createdAt))
        .limit(RECENT_TURN_LIMIT);

      const chronological = recent.map(toTurn).reverse();

      if (
        replyToSourceRef === undefined ||
        chronological.some((turn) => turn.sourceRef === replyToSourceRef)
      ) {
        return chronological;
      }

      const [extra] = await selectTurns(chatRef, replyToSourceRef)
        .orderBy(asc(conversationTurns.createdAt))
        .limit(1);

      const replied = extra === undefined ? undefined : toTurn(extra);

      if (replied === undefined) {
        return chronological;
      }

      return [...chronological, replied].sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
      );
    },

    async append(exchange) {
      const id = telegramId(exchange.userRef);

      const [user] = await db
        .insert(users)
        .values({
          telegramId: id,
          ...(exchange.displayName === undefined ? {} : { displayName: exchange.displayName }),
        })
        .onConflictDoUpdate({
          target: users.telegramId,
          set:
            exchange.displayName === undefined
              ? { telegramId: id }
              : { displayName: exchange.displayName },
        })
        .returning({ id: users.id });

      if (user === undefined) {
        throw new Error('User upsert returned no row');
      }

      const [conversation] = await db
        .insert(conversations)
        .values({ userId: user.id, source: 'telegram', externalId: exchange.chatRef })
        .onConflictDoUpdate({
          target: [conversations.source, conversations.externalId],
          set: { updatedAt: new Date() },
        })
        .returning({ id: conversations.id });

      if (conversation === undefined) {
        throw new Error('Conversation upsert returned no row');
      }

      const createdAt = new Date();

      await db.insert(conversationTurns).values({
        conversationId: conversation.id,
        role: 'user',
        body: exchange.user.body,
        sourceRef: exchange.user.sourceRef,
        createdAt,
      });

      await db.insert(conversationTurns).values({
        conversationId: conversation.id,
        role: 'assistant',
        body: exchange.assistant.body,
        sourceRef: exchange.assistant.sourceRef,
        createdAt: new Date(createdAt.getTime() + 1),
      });
    },
  };
}
