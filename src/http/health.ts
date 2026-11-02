import type { HttpRoute } from './server.ts';
import { finish } from './server.ts';

export interface ReadinessChecks {
  postgres(): Promise<void>;
  qdrant(): Promise<void>;
}

export type Readiness = Record<keyof ReadinessChecks, 'ok' | 'down'>;

export const HEALTH_PATH = '/healthz';
export const READY_PATH = '/readyz';

// R2 and the model APIs are left out on purpose: an outage there must not take the process
// out of rotation. Nothing here reports versions, hosts or error text.
export async function readiness(checks: ReadinessChecks): Promise<Readiness> {
  const [postgres, qdrant] = await Promise.allSettled([checks.postgres(), checks.qdrant()]);

  return {
    postgres: postgres.status === 'fulfilled' ? 'ok' : 'down',
    qdrant: qdrant.status === 'fulfilled' ? 'ok' : 'down',
  };
}

export function healthRoutes(checks: ReadinessChecks): HttpRoute[] {
  return [
    {
      method: 'GET',
      path: HEALTH_PATH,
      handle(req, res) {
        finish(req, res, 200);
      },
    },
    {
      method: 'GET',
      path: READY_PATH,
      async handle(req, res) {
        const state = await readiness(checks);
        const ready = Object.values(state).every((value) => value === 'ok');

        req.resume();
        res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
        res.end(JSON.stringify(state));
      },
    },
  ];
}
