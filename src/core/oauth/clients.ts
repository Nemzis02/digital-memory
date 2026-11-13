import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { database } from '../db/client.ts';
import { oauthClients } from '../db/schema.ts';

export type OAuthClientKind = 'cimd' | 'registered';

export interface OAuthClient {
  clientId: string;
  name: string;
  redirectUris: string[];
  kind: OAuthClientKind;
  metadataUrl?: string;
  fetchedAt?: Date;
  cacheUntil?: Date;
  etag?: string;
}

export interface RegisterClientInput {
  name: string;
  redirectUris: readonly string[];
}

export interface CachedMetadataInput {
  clientId: string;
  name: string;
  redirectUris: readonly string[];
  fetchedAt: Date;
  cacheUntil: Date;
  etag?: string;
}

/** Every client is public: no secret is stored, PKCE is the proof. */
export interface OAuthClients {
  find(clientId: string): Promise<OAuthClient | undefined>;
  /** A pre-registered client under a random id, for a client without a metadata document. */
  register(input: RegisterClientInput): Promise<OAuthClient>;
  list(): Promise<OAuthClient[]>;
  /** True when a row went away. */
  remove(clientId: string): Promise<boolean>;
  /** Stores or refreshes a fetched Client ID Metadata Document under its URL. */
  cacheMetadata(input: CachedMetadataInput): Promise<OAuthClient>;
}

function toClient(row: typeof oauthClients.$inferSelect): OAuthClient {
  return {
    clientId: row.clientId,
    name: row.name,
    redirectUris: row.redirectUris,
    kind: row.kind,
    ...(row.metadataUrl === null ? {} : { metadataUrl: row.metadataUrl }),
    ...(row.fetchedAt === null ? {} : { fetchedAt: row.fetchedAt }),
    ...(row.cacheUntil === null ? {} : { cacheUntil: row.cacheUntil }),
    ...(row.etag === null ? {} : { etag: row.etag }),
  };
}

export function createOAuthClients(db: Database = database()): OAuthClients {
  return {
    async find(clientId) {
      const [row] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId));

      return row === undefined ? undefined : toClient(row);
    },

    async register(input) {
      const [row] = await db
        .insert(oauthClients)
        .values({
          clientId: randomBytes(16).toString('base64url'),
          name: input.name,
          redirectUris: [...input.redirectUris],
          kind: 'registered',
        })
        .returning();

      if (row === undefined) {
        throw new Error('OAuth client insert returned no row');
      }

      return toClient(row);
    },

    async list() {
      const rows = await db.select().from(oauthClients).orderBy(oauthClients.createdAt);

      return rows.map(toClient);
    },

    async remove(clientId) {
      const removed = await db
        .delete(oauthClients)
        .where(eq(oauthClients.clientId, clientId))
        .returning({ clientId: oauthClients.clientId });

      return removed.length > 0;
    },

    async cacheMetadata(input) {
      const fields = {
        name: input.name,
        redirectUris: [...input.redirectUris],
        fetchedAt: input.fetchedAt,
        cacheUntil: input.cacheUntil,
        etag: input.etag ?? null,
      };

      const [row] = await db
        .insert(oauthClients)
        .values({ clientId: input.clientId, kind: 'cimd', metadataUrl: input.clientId, ...fields })
        .onConflictDoUpdate({ target: oauthClients.clientId, set: fields })
        .returning();

      if (row === undefined) {
        throw new Error('OAuth client upsert returned no row');
      }

      return toClient(row);
    },
  };
}
