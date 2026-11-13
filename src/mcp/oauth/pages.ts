import type { Scope } from './scopes.ts';

const SCOPE_LABELS: Record<Scope, string> = {
  'memory:read': 'Read and search your memories',
  'memory:write': 'Save new memories',
  'memory:delete': 'Delete memories',
};

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const STYLE = `
body { margin: 0; font: 16px/1.5 system-ui, sans-serif; color: #1a1a1a; background: #f6f6f6; }
main { max-width: 32rem; margin: 10vh auto; padding: 2rem; background: #fff; border-radius: 12px; }
h1 { font-size: 1.4rem; margin-top: 0; }
fieldset { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; }
label { display: block; margin: 0.4rem 0; }
button { font: inherit; padding: 0.5rem 1.2rem; border-radius: 8px; border: 1px solid #1a1a1a; background: #1a1a1a; color: #fff; cursor: pointer; }
button.secondary { background: #fff; color: #1a1a1a; }
code { word-break: break-all; }
`;

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

export function errorPage(title: string, description: string): string {
  return page(title, `<h1>${escapeHtml(title)}</h1>\n<p>${escapeHtml(description)}</p>`);
}

/** The page a stranger sees after a Telegram login with another account. Fixed text, no detail. */
export function refusalPage(): string {
  return page(
    'Login refused',
    '<h1>Login refused</h1>\n<p>This memory serves one Telegram account, and it is not the one you signed in with. Nothing about you was stored.</p>',
  );
}

export interface ConsentView {
  clientName: string;
  redirectHost: string;
  scopes: readonly string[];
  sessionId: string;
}

function scopeLabel(scope: string): string {
  return Object.hasOwn(SCOPE_LABELS, scope) ? SCOPE_LABELS[scope as Scope] : scope;
}

export function consentPage(view: ConsentView): string {
  const boxes = view.scopes
    .map(
      (scope) =>
        `<label><input type="checkbox" name="scope" value="${escapeHtml(scope)}" checked> ${escapeHtml(scopeLabel(scope))}</label>`,
    )
    .join('\n');

  return page(
    'Approve access',
    `<h1>Approve access</h1>
<p><strong>${escapeHtml(view.clientName)}</strong> wants access to your memories. After your answer the browser returns to <code>${escapeHtml(view.redirectHost)}</code>.</p>
<form method="post">
<input type="hidden" name="session" value="${escapeHtml(view.sessionId)}">
<fieldset>
<legend>Allow it to</legend>
${boxes}
</fieldset>
<p><button name="decision" value="approve">Approve</button> <button name="decision" value="deny" class="secondary">Deny</button></p>
</form>`,
  );
}
