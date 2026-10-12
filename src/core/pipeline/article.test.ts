import { describe, expect, it } from 'vitest';
import { articleText } from './article.ts';

const body = Array.from(
  { length: 12 },
  (_, index) =>
    `<p>Paragraph ${String(index)} of a long article about cita previa appointments in Valencia, with enough prose that Readability treats it as the main content.</p>`,
).join('');

describe('articleText', () => {
  it('keeps the article and drops the navigation around it', () => {
    const article = articleText(
      `<html><head><title>Cita previa</title></head><body>
         <nav><a href="/x">Home</a><a href="/y">Contact</a></nav>
         <script>window.ads = 1;</script>
         <style>.ad { display: none }</style>
         <article>${body}</article>
         <footer>Cookie notice</footer>
       </body></html>`,
    );

    expect(article.title).toBe('Cita previa');
    expect(article.text).toContain('Paragraph 0');
    expect(article.text).not.toContain('window.ads');
    expect(article.text).not.toContain('Cookie notice');
  });

  it('falls back to stripped tags when Readability finds no article', () => {
    const article = articleText(
      '<html><head><title>Short</title></head><body><div>hola</div><script>x()</script></body></html>',
    );

    expect(article.text).toContain('hola');
    expect(article.text).not.toContain('x()');
  });

  it('decodes entities and collapses whitespace', () => {
    const article = articleText(
      '<html><body><p>caf&eacute; &amp; t&#233;  \n\n\n  bar</p></body></html>',
    );

    expect(article.text).toContain('&');
    expect(article.text).not.toMatch(/\n{3}/);
  });

  it('reports no title when the page has none', () => {
    const article = articleText('<html><body><p>bare</p></body></html>');

    expect(article.title).toBeUndefined();
    expect(article.text).toContain('bare');
  });
});
