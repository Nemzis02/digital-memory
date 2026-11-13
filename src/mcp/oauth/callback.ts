import { logger } from '../../core/logging/logger.ts';
import type { LoginSessions } from '../../core/oauth/login-sessions.ts';
import { hashSecret } from '../../core/oauth/secret.ts';
import type { HttpRoute } from '../../http/server.ts';
import { clearLoginCookie, readLoginCookie, redirect, redirectWith, sendHtml } from './browser.ts';
import { CALLBACK_PATH, CONSENT_PATH } from './metadata.ts';
import { errorPage, refusalPage } from './pages.ts';
import { isAdmin, type TelegramOidc } from './telegram-oidc.ts';

const log = logger.child({ module: 'mcp' });

export interface CallbackOptions {
  origin: string;
  sessions: Pick<LoginSessions, 'find' | 'login' | 'discard'>;
  provider: Pick<TelegramOidc, 'login'>;
  adminId: number;
}

export function callbackRoute(options: CallbackOptions): HttpRoute {
  const { origin, sessions, provider, adminId } = options;

  return {
    method: 'GET',
    path: CALLBACK_PATH,
    async handle(req, res) {
      const query = new URL(req.url ?? '', origin).searchParams;
      const cleared = { 'set-cookie': clearLoginCookie() };

      const refuse = (title: string, description: string) => {
        sendHtml(req, res, 400, errorPage(title, description), cleared);
      };

      const id = readLoginCookie(req.headers);
      const session = id === undefined ? undefined : await sessions.find(id);

      if (id === undefined || session === undefined) {
        refuse(
          'Login expired',
          'The login session is missing or has expired. Start again from your client.',
        );

        return;
      }

      const { clientId, redirectUri, state } = session.request;

      const back = (params: Record<string, string>) => {
        const location = redirectWith(redirectUri, {
          ...params,
          state: state === '' ? undefined : state,
        });

        redirect(req, res, location, cleared);
      };

      if (query.get('state') !== session.state) {
        await sessions.discard(id);
        refuse('Invalid login', 'The login response does not belong to this session.');
        return;
      }

      const code = query.get('code');
      const providerError = query.get('error');

      if (providerError !== null || code === null || code === '') {
        await sessions.discard(id);
        log.info('login cancelled', { clientId, providerError });

        back({
          error: 'access_denied',
          error_description: 'The Telegram login was not completed.',
        });

        return;
      }

      const outcome = await provider.login({
        code,
        codeVerifier: session.codeVerifier,
        redirectUri: `${origin}${CALLBACK_PATH}`,
        nonce: session.nonce,
      });

      if (outcome.kind === 'refused') {
        await sessions.discard(id);
        back({ error: 'server_error', error_description: outcome.description });
        return;
      }

      if (!isAdmin(outcome.claims, adminId)) {
        await sessions.discard(id);

        log.info('login refused', {
          clientId,
          subPrefix: hashSecret(outcome.claims.sub).slice(0, 8),
        });

        sendHtml(req, res, 403, refusalPage(), cleared);
        return;
      }

      const { name } = outcome.claims;

      const bound = await sessions.login(id, {
        telegramId: adminId,
        ...(name === undefined ? {} : { displayName: name }),
      });

      if (bound === undefined) {
        refuse(
          'Login expired',
          'The login session expired before it finished. Start again from your client.',
        );

        return;
      }

      redirect(req, res, `${origin}${CONSENT_PATH}`);
    },
  };
}
