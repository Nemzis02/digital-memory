import { logger } from '../../core/logging/logger.ts';
import type { AuthorizationCodes } from '../../core/oauth/codes.ts';
import type { LoginSessions } from '../../core/oauth/login-sessions.ts';
import { hashRef } from '../../core/telemetry/attributes.ts';
import type { HttpRoute } from '../../http/server.ts';
import {
  clearLoginCookie,
  FORM_MAX_BYTES,
  readForm,
  readLoginCookie,
  redirect,
  redirectWith,
  sendHtml,
} from './browser.ts';
import { CONSENT_PATH } from './metadata.ts';
import { consentPage, errorPage } from './pages.ts';
import { SCOPES } from './scopes.ts';

const log = logger.child({ module: 'mcp' });

export const CODE_TTL_SECONDS = 600;

export interface ConsentOptions {
  origin: string;
  sessions: Pick<LoginSessions, 'find' | 'consume'>;
  codes: Pick<AuthorizationCodes, 'mint'>;
  now?: () => Date;
}

export function consentRoutes(options: ConsentOptions): HttpRoute[] {
  const { origin, sessions, codes } = options;
  const now = options.now ?? (() => new Date());
  const cleared = { 'set-cookie': clearLoginCookie() };

  return [
    {
      method: 'GET',
      path: CONSENT_PATH,
      async handle(req, res) {
        const id = readLoginCookie(req.headers);
        const session = id === undefined ? undefined : await sessions.find(id);

        if (session?.userId === undefined) {
          sendHtml(
            req,
            res,
            400,
            errorPage('Login expired', 'Log in with Telegram first. Start again from your client.'),
            cleared,
          );

          return;
        }

        const html = consentPage({
          clientName: session.request.clientName,
          redirectHost: new URL(session.request.redirectUri).host,
          scopes: session.request.scopes,
          sessionId: session.id,
        });

        sendHtml(req, res, 200, html);
      },
    },
    {
      method: 'POST',
      path: CONSENT_PATH,
      async handle(req, res) {
        const form = await readForm(req, FORM_MAX_BYTES);

        if (form === undefined) {
          sendHtml(
            req,
            res,
            413,
            errorPage('Form too large', 'The consent form was not readable.'),
          );

          return;
        }

        const id = readLoginCookie(req.headers);

        // The hidden field must repeat the cookie, so a cross-site form cannot answer for the user.
        if (id === undefined || form.get('session') !== id) {
          sendHtml(
            req,
            res,
            400,
            errorPage('Invalid request', 'The form does not belong to this login session.'),
          );

          return;
        }

        const session = await sessions.consume(id);

        if (session?.userId === undefined) {
          sendHtml(
            req,
            res,
            400,
            errorPage(
              'Login expired',
              'The login session has ended. Start again from your client.',
            ),
            cleared,
          );

          return;
        }

        const { clientId, redirectUri, state } = session.request;
        const clientState = state === '' ? undefined : state;
        const checked = form.getAll('scope');

        const approved = SCOPES.filter(
          (scope) => session.request.scopes.includes(scope) && checked.includes(scope),
        );

        if (form.get('decision') !== 'approve' || approved.length === 0) {
          log.info('consent denied', { clientId });

          const location = redirectWith(redirectUri, {
            error: 'access_denied',
            error_description: 'The user denied the request.',
            state: clientState,
          });

          redirect(req, res, location, cleared);
          return;
        }

        const code = await codes.mint({
          clientId,
          userId: session.userId,
          redirectUri,
          codeChallenge: session.request.codeChallenge,
          scopes: approved,
          resource: session.request.resource,
          expiresAt: new Date(now().getTime() + CODE_TTL_SECONDS * 1000),
        });

        log.info('consent given', { clientId, scopes: approved, userRef: hashRef(session.userId) });

        redirect(
          req,
          res,
          redirectWith(redirectUri, { code, state: clientState, iss: origin }),
          cleared,
        );
      },
    },
  ];
}
