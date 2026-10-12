import { describe, expect, it, vi } from 'vitest';
import type { FileSource } from './file-source.ts';
import type { InboundMessage } from './inbound.ts';
import { keyFromStoredReply, storedReply, storeInbound } from './save.ts';
import { objectKey } from '../storage/content.ts';
import type { ObjectStorage, UploadInput } from '../storage/object-storage.ts';

const KEY = 'documents/2026/10/11111111-1111-4111-8111-111111111111.txt';

function message(
  overrides: Partial<InboundMessage> & Pick<InboundMessage, 'type'>,
): InboundMessage {
  return {
    sourceRef: '10',
    chatRef: '7',
    userRef: '42',
    text: '',
    ...overrides,
  };
}

function recordingStorage(): { storage: ObjectStorage; uploads: UploadInput[] } {
  const uploads: UploadInput[] = [];

  return {
    uploads,
    storage: {
      async upload(input) {
        uploads.push(input);

        return {
          key: objectKey(
            input.kind,
            input.kind === 'photo' ? 'jpg' : input.kind === 'voice' ? 'ogg' : 'txt',
          ),
          size: input.body.byteLength,
          contentType: input.contentType ?? 'application/octet-stream',
        };
      },
      async presignDownload(key) {
        return `signed:${key}`;
      },
      async openStream() {
        throw new Error('unused');
      },
      async remove() {
        return undefined;
      },
    },
  };
}

describe('storeInbound', () => {
  it('uploads a photo, a document, and a voice note under their own object kind', async () => {
    const download = vi.fn(async (_fileId: string) => new Uint8Array([1, 2, 3]));
    const files: FileSource = { download };
    const { storage, uploads } = recordingStorage();

    const photo = await storeInbound(
      message({ type: 'photo', file: { fileId: 'big' } }),
      files,
      storage,
    );

    const document = await storeInbound(
      message({
        type: 'document',
        text: 'invoice',
        file: { fileId: 'doc', fileName: 'invoice.pdf', mimeType: 'application/pdf' },
      }),
      files,
      storage,
    );

    const voice = await storeInbound(
      message({ type: 'voice', file: { fileId: 'voc', mimeType: 'audio/ogg' } }),
      files,
      storage,
    );

    expect(uploads.map((upload) => upload.kind)).toEqual(['photo', 'document', 'voice']);
    expect(download.mock.calls.map((call) => call[0])).toEqual(['big', 'doc', 'voc']);
    expect(photo.key.startsWith('photos/')).toBe(true);
    expect(document.key.startsWith('documents/')).toBe(true);
    expect(voice.key.startsWith('voice/')).toBe(true);
    expect(uploads[1]).toMatchObject({ contentType: 'application/pdf', fileName: 'invoice.pdf' });
  });

  it('uploads a note and a lone URL as documents and names the key in the reply', async () => {
    const download = vi.fn();
    const files: FileSource = { download };
    const { storage, uploads } = recordingStorage();

    const note = await storeInbound(message({ type: 'text', text: 'buy milk' }), files, storage);

    const link = await storeInbound(
      message({ type: 'url', text: 'https://example.com/a', sourceUrl: 'https://example.com/a' }),
      files,
      storage,
    );

    expect(uploads.map((upload) => upload.kind)).toEqual(['document', 'document']);
    expect(uploads.map((upload) => upload.fileName)).toEqual(['note.txt', 'link.txt']);
    expect(new TextDecoder().decode(uploads[0]?.body)).toBe('buy milk');
    expect(new TextDecoder().decode(uploads[1]?.body)).toBe('https://example.com/a');
    expect(storedReply('text', note.key)).toBe(`Stored text ${note.key}`);
    expect(storedReply('url', link.key)).toBe(`Stored url ${link.key}`);
    expect(download).not.toHaveBeenCalled();
  });

  it('refuses a media message that has no file id', async () => {
    const { storage } = recordingStorage();

    await expect(
      storeInbound(message({ type: 'photo' }), { download: vi.fn() }, storage),
    ).rejects.toThrow('no file');
  });
});

describe('keyFromStoredReply', () => {
  it('reads only a key this service could have written', () => {
    expect(keyFromStoredReply(`Stored text ${KEY}`)).toBe(KEY);
    expect(keyFromStoredReply('Stored text photos/not-a-key')).toBeUndefined();
    expect(keyFromStoredReply('not built yet')).toBeUndefined();
  });
});
