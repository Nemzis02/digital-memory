import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  contentDisposition,
  downloadName,
  isObjectKey,
  objectKey,
  OCTET_STREAM,
  resolveContent,
  safeFileName,
} from './content.ts';

const bytes = (...values: (number | string)[]): Uint8Array =>
  Uint8Array.from(
    values.flatMap((value) =>
      typeof value === 'number' ? [value] : [...value].map((char) => char.charCodeAt(0)),
    ),
  );

const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'JFIF', 0x00);
const PDF = bytes('%PDF-1.7\n%', 0xe2, 0xe3, 0xcf, 0xd3);
const TEXT = bytes('a plain note with no magic number');

describe('resolveContent', () => {
  it('trusts the bytes over both sender labels', async () => {
    await expect(resolveContent(JPEG, 'text/html', 'selfie.html')).resolves.toStrictEqual({
      contentType: 'image/jpeg',
      extension: 'jpg',
      sniffed: true,
    });

    await expect(resolveContent(PDF, 'image/png', 'invoice.png')).resolves.toStrictEqual({
      contentType: 'application/pdf',
      extension: 'pdf',
      sniffed: true,
    });
  });

  it('falls back to the declared type where there is no magic number', async () => {
    await expect(resolveContent(TEXT, 'text/plain; charset=utf-8', 'notes.txt')).resolves.toEqual({
      contentType: 'text/plain',
      extension: 'txt',
      sniffed: false,
    });
  });

  it('rejects a declared type that is not a bare MIME token', async () => {
    const injected = await resolveContent(TEXT, 'text/html\r\nX-Injected: 1');

    expect(injected.contentType).toBe(OCTET_STREAM);
    expect((await resolveContent(TEXT, 'not-a-mime-type')).contentType).toBe(OCTET_STREAM);
  });

  it('takes an extension from the file name only as a last resort', async () => {
    expect((await resolveContent(TEXT, undefined, 'firmware.BIN2')).extension).toBe('bin2');
    expect((await resolveContent(TEXT, undefined, 'no-extension-here')).extension).toBe('bin');
    expect((await resolveContent(TEXT, undefined, 'weird.name-with-dashes')).extension).toBe('bin');
    expect((await resolveContent(TEXT)).extension).toBe('bin');
  });
});

describe('objectKey', () => {
  beforeEach(() => {
    vi.useFakeTimers().setSystemTime(new Date('2026-03-09T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('partitions by kind and UTC month', () => {
    expect(objectKey('photo', 'jpg')).toMatch(/^photos\/2026\/03\/[0-9a-f-]{36}\.jpg$/);
    expect(objectKey('voice', 'oga')).toMatch(/^voice\/2026\/03\/[0-9a-f-]{36}\.oga$/);
  });

  it('accepts its own output and rejects anything else', () => {
    expect(isObjectKey(objectKey('document', 'tar.gz'))).toBe(true);
    expect(isObjectKey('documents/2026/03/../../../secrets.pdf')).toBe(false);
    expect(isObjectKey('backups/2026/03/00000000-0000-4000-8000-000000000000.pdf')).toBe(false);
    expect(isObjectKey('documents/2026/03/not-a-uuid.pdf')).toBe(false);
  });
});

describe('safeFileName', () => {
  it('keeps a readable name, Cyrillic included', () => {
    expect(safeFileName('  Программа  Fallas 2023.pdf ')).toBe('Программа Fallas 2023.pdf');
  });

  it('drops any path and the leading dots that would hide or climb', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\Users\\me\\card.pdf')).toBe('card.pdf');
    expect(safeFileName('.env')).toBe('env');
  });

  it('strips control characters a header could not carry', () => {
    expect(safeFileName('bad\r\nname\u0000.pdf')).toBe('badname.pdf');
  });

  it('returns nothing when no usable name is left', () => {
    expect(safeFileName(undefined)).toBeUndefined();
    expect(safeFileName('   ')).toBeUndefined();
    expect(safeFileName('../')).toBeUndefined();
    expect(safeFileName('...')).toBeUndefined();
  });

  it('caps the length and keeps the extension', () => {
    const name = safeFileName(`${'a'.repeat(300)}.pdf`);

    expect(name).toHaveLength(255);
    expect(name?.endsWith('.pdf')).toBe(true);
  });
});

describe('contentDisposition', () => {
  it('forces a download with no name', () => {
    expect(contentDisposition()).toBe('attachment');
  });

  it('carries an ASCII fallback and the UTF-8 name', () => {
    expect(contentDisposition("Программа (2023) 'v2'.pdf")).toBe(
      'attachment; filename="_________ (2023) \'v2\'.pdf"; ' +
        "filename*=UTF-8''%D0%9F%D1%80%D0%BE%D0%B3%D1%80%D0%B0%D0%BC%D0%BC%D0%B0%20%282023%29%20%27v2%27.pdf",
    );
  });

  it('cannot be broken out of by a quote', () => {
    expect(contentDisposition('a"b.pdf')).toBe(
      `attachment; filename="a_b.pdf"; filename*=UTF-8''a%22b.pdf`,
    );
  });
});

describe('downloadName', () => {
  it('keeps a name whose extension matches the bytes, in any case', () => {
    expect(downloadName('Card.PDF', 'pdf')).toBe('Card.PDF');
  });

  it('appends the sniffed extension when the name claims another type', () => {
    expect(downloadName('selfie.html', 'jpg')).toBe('selfie.html.jpg');
    expect(downloadName('README', 'pdf')).toBe('README.pdf');
  });

  it('leaves the name alone when the bytes have no recognisable type', () => {
    expect(downloadName('README')).toBe('README');
    expect(downloadName('notes.md')).toBe('notes.md');
  });

  it('truncates by code points, so an emoji is never split', () => {
    const name = downloadName('😀'.repeat(300), 'pdf');

    expect([...(name ?? '')]).toHaveLength(255);
    expect(name?.endsWith('😀.pdf')).toBe(true);
    expect(() => contentDisposition(name)).not.toThrow();
  });

  it('stays within the length cap after appending', () => {
    expect(downloadName('a'.repeat(300), 'pdf')).toHaveLength(255);
  });

  it('returns nothing for a name with nothing usable', () => {
    expect(downloadName('../', 'pdf')).toBeUndefined();
  });
});
