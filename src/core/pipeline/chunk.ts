export const CHUNK_CHARS = 800;
export const CHUNK_OVERLAP = 100;

const SEPARATORS = ['\n\n', '\n', '. ', ' '] as const;

function pieces(text: string, limit: number): string[] {
  if (text.length <= limit) {
    return [text];
  }

  for (const separator of SEPARATORS) {
    const parts = text.split(separator).filter((part) => part !== '');

    const rejoined = parts.map((part, index) =>
      index === parts.length - 1 ? part : part + separator,
    );

    if (parts.length < 2 || rejoined.some((part) => part.length >= text.length)) {
      continue;
    }

    return rejoined.flatMap((part) => pieces(part, limit));
  }

  const hard: string[] = [];

  for (let at = 0; at < text.length; at += limit) {
    hard.push(text.slice(at, at + limit));
  }

  return hard;
}

function tail(text: string, overlap: number): string {
  if (overlap <= 0) {
    return '';
  }

  if (text.length <= overlap) {
    return text;
  }

  const slice = text.slice(-overlap);
  const boundary = slice.search(/\s/);

  return boundary === -1 ? slice : slice.slice(boundary + 1);
}

export function splitText(text: string, limit = CHUNK_CHARS, overlap = CHUNK_OVERLAP): string[] {
  const trimmed = text.trim();

  if (trimmed === '') {
    return [];
  }

  if (trimmed.length <= limit) {
    return [trimmed];
  }

  const chunks: string[] = [];
  let current = '';

  for (const piece of pieces(trimmed, limit)) {
    if (current.length + piece.length > limit && current.trim() !== '') {
      chunks.push(current.trim());
      current = tail(current, Math.min(overlap, limit - piece.length));
    }

    current += piece;
  }

  if (current.trim() !== '') {
    chunks.push(current.trim());
  }

  return chunks;
}
