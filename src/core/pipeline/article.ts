import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

export interface Article {
  title?: string;
  text: string;
}

interface ParsedDocument {
  documentElement: unknown;
}

const HIDDEN = /<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi;
const TAG = /<[^>]+>/g;
const TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i;

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decode(text: string): string {
  return text
    .replaceAll(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replaceAll(/&#(\d{1,7});/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

function collapse(text: string): string {
  return decode(text)
    .replaceAll(/[^\S\n]+/g, ' ')
    .replaceAll(/ ?\n ?/g, '\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();
}

function stripped(html: string): string {
  return collapse(html.replaceAll(HIDDEN, ' ').replaceAll(TAG, '\n'));
}

function titleOf(html: string): string | undefined {
  const title = collapse(TITLE.exec(html)?.[1] ?? '');

  return title === '' ? undefined : title;
}

export function articleText(html: string): Article {
  const title = titleOf(html);
  const { document } = parseHTML(html) as { document: ParsedDocument };
  const parsed = new Readability(document, { charThreshold: 100 }).parse();
  const text = collapse(parsed?.textContent ?? '');

  return {
    ...(parsed?.title != null && parsed.title !== ''
      ? { title: collapse(parsed.title) }
      : title === undefined
        ? {}
        : { title }),
    text: text === '' ? stripped(html) : text,
  };
}
