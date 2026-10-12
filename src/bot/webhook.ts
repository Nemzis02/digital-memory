import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { logger } from '../core/logging/logger.ts';

const log = logger.child({ module: 'bot/webhook' });

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

export function requestPath(url: string | undefined): string {
  if (url === undefined) {
    return '';
  }

  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return '';
  }
}

export function telegramWebhookUrl(publicUrl: string): string {
  const base = new URL(publicUrl);

  if (base.protocol !== 'https:') {
    throw new Error('PUBLIC_URL must be https so Telegram can deliver the webhook');
  }

  const prefix = base.pathname.endsWith('/') ? base.pathname.slice(0, -1) : base.pathname;

  return `${base.origin}${prefix}${WEBHOOK_PATH}`;
}

function discard(req: IncomingMessage, res: ServerResponse, status: number): void {
  req.resume();
  res.writeHead(status).end();
}

export function createWebhookServer(options: {
  secret: string;
  handle: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}): Server {
  return createServer((req, res) => {
    if (req.method !== 'POST' || requestPath(req.url) !== WEBHOOK_PATH) {
      discard(req, res, 404);
      return;
    }

    // webhookCallback calls getMe before it compares the secret, so a forged POST is rejected here.
    if (!secretHeaderMatches(oneHeader(req.headers[SECRET_HEADER]), options.secret)) {
      discard(req, res, 401);
      return;
    }

    void Promise.resolve()
      .then(() => options.handle(req, res))
      .catch((error: unknown) => {
        log.error('webhook handler failed', { error });

        if (!res.headersSent) {
          res.writeHead(500).end();
        }
      });
  });
}
