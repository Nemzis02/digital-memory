import type { UUID } from 'node:crypto';
import type { Database } from './client.ts';
import { users } from './schema.ts';

/** Creates or updates the user behind a Telegram id and returns its row id. */
export async function upsertUser(
  db: Database,
  telegramId: number,
  displayName?: string,
): Promise<UUID> {
  const [user] = await db
    .insert(users)
    .values({
      telegramId,
      ...(displayName === undefined ? {} : { displayName }),
    })
    .onConflictDoUpdate({
      target: users.telegramId,
      set: displayName === undefined ? { telegramId } : { displayName },
    })
    .returning({ id: users.id });

  if (user === undefined) {
    throw new Error('User upsert returned no row');
  }

  return user.id as UUID;
}
