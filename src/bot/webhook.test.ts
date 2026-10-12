import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createWebhookServer,
  oneHeader,
  requestPath,
  secretHeaderMatches,
  telegramWebhookUrl,
  WEBHOOK_PATH,
} from './webhook.ts';

const SECRET = 'a'.repeat(32);

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new Error('webhook test server has no port');
  }

  return address.port;
}

describe('webhook gate', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers
        .splice(0)
        .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
  });

  it('compares the secret without leaking it through a short header', () => {
    expect(secretHeaderMatches(SECRET, SECRET)).toBe(true);
    expect(secretHeaderMatches('nope', SECRET)).toBe(false);
    expect(secretHeaderMatches(undefined, SECRET)).toBe(false);
    expect(secretHeaderMatches(SECRET.slice(0, 4), SECRET)).toBe(false);
    expect(oneHeader(['only'])).toBe('only');
    expect(oneHeader(['a', 'b'])).toBeUndefined();
    expect(requestPath(`${WEBHOOK_PATH}?q=1`)).toBe(WEBHOOK_PATH);

    expect(telegramWebhookUrl('https://example.com/app/')).toBe(
      'https://example.com/app/telegram/webhook',
    );

    expect(() => telegramWebhookUrl('http://example.com')).toThrow('https');
  });

  it('rejects a forged update before the handler runs', async () => {
    let seen = 0;

    const server = createWebhookServer({
      secret: SECRET,
      handle(_req, res) {
        seen += 1;
        res.writeHead(200).end();
      },
    });

    servers.push(server);

    const port = await listen(server);
    const url = `http://127.0.0.1:${port}${WEBHOOK_PATH}`;

    expect((await fetch(url)).status).toBe(404);

    const forged = await fetch(url, {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'wrong-secret-value' },
      body: '{"update_id":1}',
    });

    const missing = await fetch(url, { method: 'POST', body: '{"update_id":1}' });

    expect(forged.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(seen).toBe(0);

    const accepted = await fetch(url, {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': SECRET },
      body: '{"update_id":1}',
    });

    expect(accepted.status).toBe(200);
    expect(seen).toBe(1);
  });

  it('returns 500 when the handler throws and the response is still open', async () => {
    const server = createWebhookServer({
      secret: SECRET,
      handle() {
        throw new Error('boom');
      },
    });

    servers.push(server);

    const port = await listen(server);

    const response = await fetch(`http://127.0.0.1:${port}${WEBHOOK_PATH}`, {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': SECRET },
      body: '{}',
    });

    expect(response.status).toBe(500);
  });
});
