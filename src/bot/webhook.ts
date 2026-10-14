import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createHttpServer, finish, type HttpRoute } from '../http/server.ts';

export { requestPath } from '../http/server.ts';

export const WEBHOOK_PATH = '/telegram/webhook';

export const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

export function secretHeaderMatches(provided: string | undefined, expected: string): boolean {
  const actual = createHash('sha256')
    .update(provided ?? '\0missing')
    .digest();

  const wanted = createHash('sha256').update(expected).digest();

  return timingSafeEqual(actual, wanted);
}

export function oneHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value.length === 1 ? value[0] : undefined;
  }

  return value;
}

export function telegramWebhookUrl(publicUrl: string): string {
  const base = new URL(publicUrl);

  if (base.protocol !== 'https:') {
    throw new Error('PUBLIC_URL must be https so Telegram can deliver the webhook');
  }

  const prefix = base.pathname.endsWith('/') ? base.pathname.slice(0, -1) : base.pathname;

  return `${base.origin}${prefix}${WEBHOOK_PATH}`;
}

export function telegramWebhookRoute(options: {
  secret: string;
  handle: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}): HttpRoute {
  return {
    method: 'POST',
    path: WEBHOOK_PATH,
    handle(req, res) {
      // webhookCallback calls getMe before it compares the secret, so a forged POST is rejected here.
      if (!secretHeaderMatches(oneHeader(req.headers[SECRET_HEADER]), options.secret)) {
        finish(req, res, 401);
        return;
      }

      return options.handle(req, res);
    },
  };
}

export function createWebhookServer(options: {
  secret: string;
  handle: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}): Server {
  return createHttpServer([telegramWebhookRoute(options)]);
}
