import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isObjectKey, objectKey, OCTET_STREAM, resolveContent } from './content.ts';

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
    });

    await expect(resolveContent(PDF, 'image/png', 'invoice.png')).resolves.toStrictEqual({
      contentType: 'application/pdf',
      extension: 'pdf',
    });
  });

  it('falls back to the declared type where there is no magic number', async () => {
    await expect(resolveContent(TEXT, 'text/plain; charset=utf-8', 'notes.txt')).resolves.toEqual({
      contentType: 'text/plain',
      extension: 'txt',
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
