import type { InboundMessage } from '../../ingestion/inbound.ts';
import { logger } from '../../logging/logger.ts';
import type { MemoryType } from '../../memory/payload.ts';
import type { ObjectKind, UploadInput } from '../../storage/object-storage.ts';
import type { PipelineDeps } from '../deps.ts';
import type { IngestionStateType, IngestionUpdate } from '../state.ts';

const log = logger.child({ module: 'pipeline/file-handler' });

type Deps = Pick<PipelineDeps, 'files' | 'storage' | 'urls'>;

function objectKind(type: MemoryType): ObjectKind {
  if (type === 'photo' || type === 'document' || type === 'voice') {
    return type;
  }

  return 'document';
}

function encoded(text: string, fileName: string): Omit<UploadInput, 'kind'> {
  return { body: new TextEncoder().encode(text), contentType: 'text/plain', fileName };
}

async function linkBody(deps: Deps, url: string): Promise<Omit<UploadInput, 'kind'>> {
  try {
    const page = await deps.urls.fetch(url);

    return { body: page.body, contentType: page.contentType, fileName: 'page.html' };
  } catch (error) {
    log.warn('could not fetch the page, storing the link alone', { error });

    return encoded(url, 'link.txt');
  }
}

async function upload(deps: Deps, message: InboundMessage): Promise<Omit<UploadInput, 'kind'>> {
  if (message.type === 'photo' || message.type === 'document' || message.type === 'voice') {
    const file = message.file;

    if (file === undefined) {
      throw new Error(`A ${message.type} message has no file to download`);
    }

    return {
      body: await deps.files.download(file.fileId),
      ...(file.mimeType === undefined ? {} : { contentType: file.mimeType }),
      ...(file.fileName === undefined ? {} : { fileName: file.fileName }),
    };
  }

  if (message.type === 'url') {
    return linkBody(deps, message.sourceUrl ?? message.text);
  }

  return encoded(message.text, 'note.txt');
}

export function createFileHandlerNode(deps: Deps) {
  return async (state: IngestionStateType): Promise<IngestionUpdate> => {
    const { message } = state;

    const stored = await deps.storage.upload({
      kind: objectKind(message.type),
      ...(await upload(deps, message)),
    });

    log.info('stored', { type: message.type, key: stored.key, size: stored.size });

    // Notes and links upload under internal names like `page.html`; only a sender's name is kept.
    const fileName = message.file === undefined ? undefined : stored.fileName;

    return {
      stored: {
        key: stored.key,
        contentType: stored.contentType,
        ...(fileName === undefined ? {} : { fileName }),
      },
    };
  };
}
