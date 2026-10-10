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
    };
  }

  return {
    contentType: sniffed.mime,
    extension: safeExtension(sniffed.ext) ?? 'bin',
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
