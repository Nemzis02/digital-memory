import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { healthRoutes, readiness } from './health.ts';
import { closeServer, createHttpServer, listenOn } from './server.ts';

const up = () => Promise.resolve();
const down = () => Promise.reject(new Error('connection refused at 10.0.0.1:5432'));

describe('health routes', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => closeServer(server)));
  });

  async function serve(checks: { postgres(): Promise<void>; qdrant(): Promise<void> }) {
    const server = createHttpServer(healthRoutes(checks));

    servers.push(server);

    return `http://127.0.0.1:${await listenOn(server, 0)}`;
  }

  it('answers healthz without touching any dependency', async () => {
    let touched = 0;

    const touch = () => {
      touched += 1;

      return Promise.resolve();
    };

    const base = await serve({ postgres: touch, qdrant: touch });
    const response = await fetch(`${base}/healthz`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(touched).toBe(0);
    expect((await fetch(`${base}/healthz`, { method: 'POST' })).status).toBe(404);
  });

  it('is ready only when both stores answer', async () => {
    const base = await serve({ postgres: up, qdrant: up });
    const response = await fetch(`${base}/readyz`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ postgres: 'ok', qdrant: 'ok' });
  });

  it('names the store that is down and keeps the error to itself', async () => {
    const base = await serve({ postgres: down, qdrant: up });
    const response = await fetch(`${base}/readyz`);
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toEqual({ postgres: 'down', qdrant: 'ok' });
    expect(body).not.toContain('10.0.0.1');
  });

  it('checks both stores even when the first one fails', async () => {
    await expect(readiness({ postgres: down, qdrant: down })).resolves.toEqual({
      postgres: 'down',
      qdrant: 'down',
    });
  });
});
