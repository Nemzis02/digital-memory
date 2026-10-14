import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { logger } from '../core/logging/logger.ts';

const log = logger.child({ module: 'http' });

export interface HttpRoute {
  method: string;
  path: string;
  handle(req: IncomingMessage, res: ServerResponse): void | Promise<void>;
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

export function finish(req: IncomingMessage, res: ServerResponse, status: number): void {
  req.resume();
  res.writeHead(status).end();
}

export function createHttpServer(routes: readonly HttpRoute[]): Server {
  return createServer((req, res) => {
    const path = requestPath(req.url);

    const route = routes.find(
      (candidate) => candidate.method === req.method && candidate.path === path,
    );

    if (route === undefined) {
      finish(req, res, 404);
      return;
    }

    void Promise.resolve()
      .then(() => route.handle(req, res))
      .catch((error: unknown) => {
        log.error('request failed', { error });

        if (!res.headersSent) {
          res.writeHead(500).end();
        }
      });
  });
}

export function listenOn(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);

    server.listen(port, () => {
      server.off('error', reject);

      const address = server.address();

      resolve(typeof address === 'object' && address !== null ? address.port : port);
    });
  });
}

export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}
