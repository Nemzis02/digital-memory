import { describe, expect, it } from 'vitest';
import { withTempDatabase } from '../../test/integration.ts';
import { runMigrations } from '../db/migrate.ts';
import { createOAuthClients } from './clients.ts';

const METADATA_URL = 'https://client.example/oauth/client.json';

describe('oauth clients', () => {
  it('registers, lists, finds and removes a pre-registered client', async () => {
    await withTempDatabase(async ({ db }) => {
      await runMigrations(db);

      const clients = createOAuthClients(db);

      expect(await clients.find('missing')).toBeUndefined();

      const registered = await clients.register({
        name: 'Cursor',
        redirectUris: ['cursor://anysphere.cursor-mcp/oauth/callback'],
      });

      expect(registered.clientId).toMatch(/^[A-Za-z0-9_-]{22}$/);

      expect(registered).toEqual({
        clientId: registered.clientId,
        name: 'Cursor',
        redirectUris: ['cursor://anysphere.cursor-mcp/oauth/callback'],
        kind: 'registered',
      });

      expect(await clients.find(registered.clientId)).toEqual(registered);
      expect(await clients.list()).toEqual([registered]);

      expect(await clients.remove(registered.clientId)).toBe(true);
      expect(await clients.remove(registered.clientId)).toBe(false);
      expect(await clients.list()).toEqual([]);
    });
  });

  it('caches a metadata document under its URL and refreshes it in place', async () => {
    await withTempDatabase(async ({ db }) => {
      await runMigrations(db);

      const clients = createOAuthClients(db);
      const first = new Date('2026-11-12T10:00:00Z');
      const second = new Date('2026-11-12T11:00:00Z');
      const until = new Date('2026-11-13T10:00:00Z');

      const cached = await clients.cacheMetadata({
        clientId: METADATA_URL,
        name: 'Claude',
        redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
        fetchedAt: first,
        cacheUntil: until,
        etag: '"v1"',
      });

      expect(cached).toEqual({
        clientId: METADATA_URL,
        name: 'Claude',
        redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
        kind: 'cimd',
        metadataUrl: METADATA_URL,
        fetchedAt: first,
        cacheUntil: until,
        etag: '"v1"',
      });

      const refreshed = await clients.cacheMetadata({
        clientId: METADATA_URL,
        name: 'Claude',
        redirectUris: ['https://claude.ai/api/mcp/auth_callback', 'http://127.0.0.1/callback'],
        fetchedAt: second,
        cacheUntil: second,
      });

      expect(refreshed.fetchedAt).toEqual(second);
      expect(refreshed.cacheUntil).toEqual(second);
      expect(refreshed.redirectUris).toHaveLength(2);
      expect(refreshed.etag).toBeUndefined();
      expect(await clients.list()).toEqual([refreshed]);
    });
  });
});
