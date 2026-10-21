import type { UUID } from 'node:crypto';
import { toTelegramHTML } from 'md-to-telegram';
import type { IngestResult } from '../pipeline/graph.ts';
import type { Answer, CitationFile } from '../retrieval/answer.ts';

// sendMessage rejects anything longer, and a synthesised answer can exceed it.
const TELEGRAM_TEXT_LIMIT = 4096;

export interface ReplyFile extends CitationFile {
  summary: string;
}

export type RouteReply =
  | { text: string; html?: string; files?: ReplyFile[]; keyboard: 'undo' | 'none' }
  | { text: string; html?: string; keyboard: 'forget'; parentId: UUID };

function clip(text: string): string {
  return text.length <= TELEGRAM_TEXT_LIMIT ? text : text.slice(0, TELEGRAM_TEXT_LIMIT);
}

/** Clips the plain text to what sendMessage accepts; the HTML is split by the bot instead. */
export function present(reply: RouteReply): RouteReply {
  const text = clip(reply.text);

  return text === reply.text ? reply : { ...reply, text };
}

export function savedReply(result: IngestResult): string {
  return [`Saved ${result.kind} · ${result.category}`, result.summary, result.tags.join(' ')]
    .filter((line) => line !== '')
    .join('\n');
}

export function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** Renders an answer as plain text and Telegram HTML; cited files ride along instead of a line. */
export function formatAnswer(answer: Answer): { text: string; html: string; files?: ReplyFile[] } {
  const lines = [answer.answer];
  const htmlLines = [toTelegramHTML(answer.answer).text];
  const files: ReplyFile[] = [];

  for (const citation of answer.citations) {
    const file = citation.file;

    if (file !== undefined) {
      files.push({ ...file, summary: citation.summary });
      continue;
    }

    lines.push('', citation.summary);

    const url = citation.url;

    if (url === undefined) {
      htmlLines.push('', escapeHtml(citation.summary));
      continue;
    }

    const href = escapeHtml(url).replaceAll('"', '&quot;');

    htmlLines.push('', `<a href="${href}">${escapeHtml(citation.summary)}</a>`);
  }

  return {
    text: lines.join('\n'),
    html: htmlLines.join('\n'),
    ...(files.length === 0 ? {} : { files }),
  };
}
