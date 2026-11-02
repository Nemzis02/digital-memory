import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createPool, ping } from '../core/db/client.ts';
import { createQdrantStore } from '../core/vector/qdrant.ts';
import { integrationEnv, withTempCollection } from '../test/integration.ts';
import { healthRoutes } from './health.ts';
import type { ReadinessChecks } from './health.ts';
import { closeServer, createHttpServer, listenOn } from './server.ts';

describe('/readyz against real stores', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => closeServer(server)));
  });

  async function readyz(checks: ReadinessChecks): Promise<Response> {
    const server = createHttpServer(healthRoutes(checks));

    servers.push(server);

    return fetch(`http://127.0.0.1:${await listenOn(server, 0)}/readyz`);
  }

  it('is 200 while Postgres and the collection answer', async () => {
    await withTempCollection(async (env) => {
      const store = createQdrantStore(env);
      const pool = createPool(env);

      await store.init();

      try {
        const response = await readyz({ postgres: () => ping(pool), qdrant: () => store.ping() });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ postgres: 'ok', qdrant: 'ok' });
      } finally {
        await pool.end();
      }
    });
  });

  it('is 503 and names qdrant when its port is closed', async () => {
    const env = integrationEnv({ QDRANT_URL: 'http://127.0.0.1:1' });
    const store = createQdrantStore(env);
    const pool = createPool(env);

    try {
      const response = await readyz({ postgres: () => ping(pool), qdrant: () => store.ping() });

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ postgres: 'ok', qdrant: 'down' });
    } finally {
      await pool.end();
    }
  });
});
