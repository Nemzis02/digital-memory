import { describe, expect, it } from 'vitest';
import { consentPage, errorPage, escapeHtml, refusalPage } from './pages.ts';
import { USER } from './fixtures.ts';

describe('escapeHtml', () => {
  it('escapes the five html characters and nothing else', () => {
    expect(escapeHtml(`<a href="x">&'é`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;é');
  });
});

describe('errorPage and refusalPage', () => {
  it('render a full document with the escaped title and text', () => {
    const html = errorPage('Unknown <client>', 'It said "no".');

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>Unknown &lt;client&gt;</title>');
    expect(html).toContain('<h1>Unknown &lt;client&gt;</h1>');
    expect(html).toContain('<p>It said &quot;no&quot;.</p>');
    expect(html).not.toContain('<script');
  });

  it('refuses with fixed text and no detail', () => {
    const html = refusalPage();

    expect(html).toContain('<h1>Login refused</h1>');
    expect(html).toContain('Nothing about you was stored.');
  });
});

describe('consentPage', () => {
  it('shows the client, the host, every requested scope checked, and the session', () => {
    const html = consentPage({
      clientName: 'Cursor <script>alert(1)</script>',
      redirectHost: 'client.example',
      scopes: ['memory:read', 'memory:delete'],
      sessionId: USER,
    });

    expect(html).toContain('<strong>Cursor &lt;script&gt;alert(1)&lt;/script&gt;</strong>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<code>client.example</code>');
    expect(html).toContain('<form method="post">');
    expect(html).toContain(`<input type="hidden" name="session" value="${USER}">`);

    expect(html).toContain(
      '<input type="checkbox" name="scope" value="memory:read" checked> Read and search your memories',
    );

    expect(html).toContain(
      '<input type="checkbox" name="scope" value="memory:delete" checked> Delete memories',
    );

    expect(html).not.toContain('memory:write');
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).toContain('<button name="decision" value="approve">Approve</button>');
    expect(html).toContain('<button name="decision" value="deny" class="secondary">Deny</button>');
  });
});
