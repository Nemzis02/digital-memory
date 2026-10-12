import type { MemoryType } from '../memory/payload.ts';
import { isObjectKey } from '../storage/content.ts';
import type { ObjectKind, ObjectStorage } from '../storage/object-storage.ts';
import type { FileSource } from './file-source.ts';
import type { InboundMessage } from './inbound.ts';

const STORED = /^Stored (?:text|photo|document|url|voice) (\S+)$/;

export interface StoredInbound {
  type: MemoryType;
  key: string;
}

export function storedReply(type: MemoryType, key: string): string {
  return `Stored ${type} ${key}`;
}

export function keyFromStoredReply(text: string): string | undefined {
  const key = STORED.exec(text.trim())?.[1];

  return key !== undefined && isObjectKey(key) ? key : undefined;
}

function objectKind(type: MemoryType): ObjectKind {
  if (type === 'photo' || type === 'document' || type === 'voice') {
    return type;
  }

  // Notes and links have no Telegram file. `document` is the only non-media object kind.
  return 'document';
}

export async function storeInbound(
  message: InboundMessage,
  files: FileSource,
  storage: ObjectStorage,
): Promise<StoredInbound> {
  const fileBacked =
    message.type === 'photo' || message.type === 'document' || message.type === 'voice';

  const file = message.file;

  if (fileBacked && file === undefined) {
    throw new Error(`A ${message.type} message has no file to download`);
  }

  const body =
    fileBacked && file !== undefined
      ? await files.download(file.fileId)
      : new TextEncoder().encode(
          message.type === 'url' ? (message.sourceUrl ?? message.text) : message.text,
        );

  const contentType = fileBacked ? file?.mimeType : 'text/plain';
  const fileName = fileBacked ? file?.fileName : message.type === 'url' ? 'link.txt' : 'note.txt';

  const stored = await storage.upload({
    kind: objectKind(message.type),
    body,
    ...(contentType === undefined ? {} : { contentType }),
    ...(fileName === undefined ? {} : { fileName }),
  });

  return { type: message.type, key: stored.key };
}
