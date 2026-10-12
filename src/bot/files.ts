import type { FileSource } from '../core/ingestion/file-source.ts';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

const FILE_HOST = 'api.telegram.org';

const SAFE_FILE_PATH = /^[\w./-]+$/;

export interface TelegramFiles {
  getFile(fileId: string): Promise<{ file_path?: string }>;
}

async function readLimited(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      total += value.byteLength;

      if (total > maxBytes) {
        throw new Error('Telegram file is too large');
      }

      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

export function telegramFileSource(
  files: TelegramFiles,
  token: string,
  maxBytes = MAX_FILE_BYTES,
): FileSource {
  return {
    async download(fileId) {
      const file = await files.getFile(fileId);
      const filePath = file.file_path;

      if (
        filePath === undefined ||
        filePath.startsWith('/') ||
        !SAFE_FILE_PATH.test(filePath) ||
        filePath.split('/').includes('..')
      ) {
        throw new Error('Telegram file path was missing or not a relative path');
      }

      const url = `https://${FILE_HOST}/file/bot${token}/${filePath}`;

      const response = await fetch(url).catch((error: unknown) => {
        throw new Error('Telegram file download failed', { cause: error });
      });

      if (response.url !== '' && new URL(response.url).hostname !== FILE_HOST) {
        throw new Error('Telegram file download left api.telegram.org');
      }

      if (!response.ok) {
        throw new Error(`Telegram file download failed (${response.status})`);
      }

      const declared = Number(response.headers.get('content-length') ?? '0');

      if (Number.isFinite(declared) && declared > maxBytes) {
        throw new Error('Telegram file is too large');
      }

      if (response.body === null) {
        throw new Error('Telegram file download returned no body');
      }

      return readLimited(response.body, maxBytes);
    },
  };
}
