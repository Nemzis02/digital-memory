import { randomUUID } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import type { ObjectKind } from './object-storage.ts';

export const OCTET_STREAM = 'application/octet-stream';

const PREFIXES: Record<ObjectKind, string> = {
  photo: 'photos',
  document: 'documents',
  voice: 'voice',
};

const MIME_TOKEN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$/;

function declaredType(declared: string | undefined): string | undefined {
  const base = declared?.split(';')[0]?.trim().toLowerCase();

  return base !== undefined && MIME_TOKEN.test(base) ? base : undefined;
}

const EXTENSION = '[a-z0-9]{1,8}(?:\\.[a-z0-9]{1,8})?';

const SAFE_EXTENSION = new RegExp(`^${EXTENSION}$`);

function safeExtension(candidate: string | undefined): string | undefined {
  const normalized = candidate?.toLowerCase();

  return normalized !== undefined && SAFE_EXTENSION.test(normalized) ? normalized : undefined;
}

function extensionFromName(fileName: string | undefined): string | undefined {
  const dot = fileName === undefined ? -1 : fileName.lastIndexOf('.');

  if (fileName === undefined || dot <= 0) {
    return undefined;
  }

  return safeExtension(fileName.slice(dot + 1));
}

export interface ResolvedContent {
  contentType: string;
  extension: string;
  sniffed: boolean;
}

export async function resolveContent(
  body: Uint8Array,
  declared?: string,
  fileName?: string,
): Promise<ResolvedContent> {
  const sniffed = await fileTypeFromBuffer(body);

  if (sniffed === undefined) {
    return {
      contentType: declaredType(declared) ?? OCTET_STREAM,
      extension: extensionFromName(fileName) ?? 'bin',
      sniffed: false,
    };
  }

  return {
    contentType: sniffed.mime,
    extension: safeExtension(sniffed.ext) ?? 'bin',
    sniffed: true,
  };
}

export function objectKey(kind: ObjectKind, extension: string): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');

  return `${PREFIXES[kind]}/${now.getUTCFullYear()}/${month}/${randomUUID()}.${extension}`;
}

const KEY = new RegExp(
  `^(?:${Object.values(PREFIXES).join('|')})/\\d{4}/\\d{2}/[0-9a-f-]{36}\\.${EXTENSION}$`,
);

export function isObjectKey(key: string): boolean {
  return KEY.test(key);
}

const MAX_FILE_NAME = 255;

// Telegram passes the sender's name through untouched; it reaches an HTTP header and an upload.
export function safeFileName(name: string | undefined): string | undefined {
  const base = name?.split(/[/\\]/).at(-1) ?? '';

  const cleaned = base
    .replaceAll(/\p{Cc}/gu, '')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .trim();

  if (cleaned === '') {
    return undefined;
  }

  const chars = [...cleaned];

  if (chars.length <= MAX_FILE_NAME) {
    return cleaned;
  }

  const dot = cleaned.lastIndexOf('.');
  const extension = dot > 0 ? [...cleaned.slice(dot)] : [];
  const keep = extension.length <= 16 ? extension : [];

  return [...chars.slice(0, MAX_FILE_NAME - keep.length), ...keep].join('');
}

// A sniffed extension wins, so a sender cannot label JPEG bytes as `selfie.html`.
export function downloadName(name: string | undefined, sniffed?: string): string | undefined {
  const safe = safeFileName(name);

  if (safe === undefined || sniffed === undefined || safe.toLowerCase().endsWith(`.${sniffed}`)) {
    return safe;
  }

  // Code points, not UTF-16 units: a split surrogate pair makes encodeURIComponent throw.
  const head = [...safe].slice(0, MAX_FILE_NAME - sniffed.length - 1).join('');

  return `${head}.${sniffed}`;
}

function percentEncoded(value: string): string {
  return encodeURIComponent(value).replaceAll(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

// RFC 6266: an ASCII `filename` for old clients, `filename*` for the real name.
export function contentDisposition(fileName?: string): string {
  if (fileName === undefined) {
    return 'attachment';
  }

  const ascii = fileName.replaceAll(/[^\x20-\x7e]|["\\]/g, '_');

  return `attachment; filename="${ascii}"; filename*=UTF-8''${percentEncoded(fileName)}`;
}
