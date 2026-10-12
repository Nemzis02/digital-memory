import { afterEach, describe, expect, it, vi } from 'vitest';
import { telegramFileSource } from './files.ts';
import type { TelegramFiles } from './files.ts';

const TOKEN = '123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; // gitleaks:allow

function files(filePath?: string): TelegramFiles {
  return {
    async getFile() {
      return filePath === undefined ? {} : { file_path: filePath };
    },
  };
}

describe('telegramFileSource', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('downloads the bytes from api.telegram.org and nowhere else', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([9, 8, 7])));

    vi.stubGlobal('fetch', fetchMock);

    const source = telegramFileSource(files('photos/a.jpg'), TOKEN);
    const body = await source.download('file-1');

    expect(body).toEqual(new Uint8Array([9, 8, 7]));

    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.telegram.org/file/bot${TOKEN}/photos/a.jpg`,
    );
  });

  it('refuses a path that could leave the file host, before calling fetch', async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal('fetch', fetchMock);

    const source = telegramFileSource(files('../etc/passwd'), TOKEN);

    await expect(source.download('file-1')).rejects.toThrow('not a relative path');

    await expect(
      telegramFileSource(files('/etc/passwd'), TOKEN).download('file-1'),
    ).rejects.toThrow('not a relative path');

    await expect(telegramFileSource(files(undefined), TOKEN).download('file-1')).rejects.toThrow(
      'not a relative path',
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not put the bot token in a download error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error(`connect ${TOKEN}`);
      }),
    );

    await expect(
      telegramFileSource(files('voice/a.ogg'), TOKEN).download('file-1'),
    ).rejects.toThrow(/^Telegram file download failed$/);
  });

  it('stops when the declared length or the stream exceeds the cap', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([1]), { headers: { 'content-length': '9' } })),
    );

    await expect(
      telegramFileSource(files('photos/a.jpg'), TOKEN, 8).download('file-1'),
    ).rejects.toThrow('too large');

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(9));
        controller.close();
      },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(stream)),
    );

    await expect(
      telegramFileSource(files('photos/a.jpg'), TOKEN, 8).download('file-1'),
    ).rejects.toThrow('too large');
  });

  it('rejects a download that followed a redirect off api.telegram.org', async () => {
    const response = new Response(new Uint8Array([1]));

    Object.defineProperty(response, 'url', { value: 'https://evil.example/file' });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    );

    await expect(
      telegramFileSource(files('photos/a.jpg'), TOKEN).download('file-1'),
    ).rejects.toThrow('left api.telegram.org');
  });
});
