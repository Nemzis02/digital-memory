import type { UUID } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { database } from '../db/client.ts';
import { oauthLoginSessions } from '../db/schema.ts';
import { upsertUser } from '../db/users.ts';

/** The validated authorize request, kept until the consent step mints a code for it. */
export interface AuthorizeRequest {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  resource: string;
  state: string;
}

export interface LoginSessionInput {
  request: AuthorizeRequest;
  /** The `state` and `nonce` sent to the identity provider, and the PKCE verifier for it. */
  state: string;
  nonce: string;
  codeVerifier: string;
  expiresAt: Date;
}

export interface LoginSession extends LoginSessionInput {
  id: UUID;
  userId?: UUID;
}

export interface TelegramUser {
  telegramId: number;
  displayName?: string;
}

export interface LoginSessionsOptions {
  now?: () => Date;
}

/** One browser login between /oauth/authorize and the consent approval. */
export interface LoginSessions {
  start(input: LoginSessionInput): Promise<UUID>;
  /** A live session: not consumed and not expired. */
  find(id: UUID): Promise<LoginSession | undefined>;
  /** Upserts the user and binds the live session to it. */
  login(id: UUID, user: TelegramUser): Promise<LoginSession | undefined>;
  /** Hands the live session out once. */
  consume(id: UUID): Promise<LoginSession | undefined>;
  /** Drops the row, so a refused login leaves nothing behind. */
  discard(id: UUID): Promise<void>;
}

function toSession(row: typeof oauthLoginSessions.$inferSelect): LoginSession {
  return {
    id: row.id as UUID,
    request: row.request,
    state: row.state,
    nonce: row.nonce,
    codeVerifier: row.codeVerifier,
    expiresAt: row.expiresAt,
    ...(row.userId === null ? {} : { userId: row.userId as UUID }),
  };
}

export function createLoginSessions(
  db: Database = database(),
  options: LoginSessionsOptions = {},
): LoginSessions {
  const now = options.now ?? (() => new Date());

  const live = (id: UUID, at: Date) =>
    and(
      eq(oauthLoginSessions.id, id),
      isNull(oauthLoginSessions.consumedAt),
      gt(oauthLoginSessions.expiresAt, at),
    );

  return {
    async start(input) {
      const [row] = await db
        .insert(oauthLoginSessions)
        .values({
          request: input.request,
          state: input.state,
          nonce: input.nonce,
          codeVerifier: input.codeVerifier,
          expiresAt: input.expiresAt,
        })
        .returning({ id: oauthLoginSessions.id });

      if (row === undefined) {
        throw new Error('Login session insert returned no row');
      }

      return row.id as UUID;
    },

    async find(id) {
      const [row] = await db.select().from(oauthLoginSessions).where(live(id, now()));

      return row === undefined ? undefined : toSession(row);
    },

    async login(id, user) {
      const userId = await upsertUser(db, user.telegramId, user.displayName);

      const [row] = await db
        .update(oauthLoginSessions)
        .set({ userId })
        .where(live(id, now()))
        .returning();

      return row === undefined ? undefined : toSession(row);
    },

    async consume(id) {
      const at = now();

      const [row] = await db
        .update(oauthLoginSessions)
        .set({ consumedAt: at })
        .where(live(id, at))
        .returning();

      return row === undefined ? undefined : toSession(row);
    },

    async discard(id) {
      await db.delete(oauthLoginSessions).where(eq(oauthLoginSessions.id, id));
    },
  };
}
