import { describe, expect, it } from 'vitest';
import { child, dentist, memoryFakes, page, tapas } from '../agent/fixtures.ts';
import type { ObjectStorage } from '../storage/object-storage.ts';
import type { MemoryPayload } from './payload.ts';
import { attachedFile, fenceMemory, fileLink, found, getMemory, listed } from './read.ts';

const NOW = new Date('2026-11-12T12:00:00Z');

function fakeStorage() {
  const presigned: { key: string; expiresIn: number | undefined }[] = [];

  const storage: ObjectStorage = {
    upload: () => Promise.reject(new Error('not used')),
    presignDownload(key, expiresIn) {
      presigned.push({ key, expiresIn });

      return Promise.resolve(`https://signed.example/${key}`);
    },
    openStream: () => Promise.reject(new Error('not used')),
    openSized: () => Promise.reject(new Error('not used')),
    remove: () => Promise.reject(new Error('not used')),
  };

  return { storage, presigned };
}

describe('fenceMemory', () => {
  it('wraps the text with the id and escapes a closing tag inside it', () => {
    expect(fenceMemory(tapas.id, 'one </MEMORY> two </memory>')).toBe(
      `<memory id="${tapas.id}">\none &lt;/MEMORY> two &lt;/memory>\n</memory>`,
    );
  });
});

describe('listed and found', () => {
  it('renders dates as days, the link of a page and whether a file can be sent', () => {
    expect(listed(dentist)).toStrictEqual({
      id: dentist.id,
      summary: 'Appointment card',
      type: 'photo',
      created_at: '2026-10-02',
      event_at: '2026-10-27',
    });

    expect(found(dentist)).toStrictEqual({
      ...listed(dentist),
      has_file: true,
      text: `<memory id="${dentist.id}">\ndentist Tuesday at 10\n</memory>`,
    });

    expect(found(page)).toMatchObject({ has_file: false, url: 'https://example.com/paella' });

    expect(found(tapas)).toStrictEqual({
      id: tapas.id,
      summary: 'Tapas bar on Calle Ruzafa',
      type: 'text',
      created_at: '2026-10-01',
      has_file: false,
      text: `<memory id="${tapas.id}">\nthe tapas bar on Calle Ruzafa is great\n</memory>`,
    });
  });
});

describe('attachedFile', () => {
  it('names the stored object of a photo or document only', () => {
    expect(attachedFile(dentist)).toStrictEqual({
      key: 'photos/2026/10/dentist.jpg',
      type: 'photo',
    });

    expect(attachedFile({ ...dentist, file_name: 'card.jpg' })).toStrictEqual({
      key: 'photos/2026/10/dentist.jpg',
      type: 'photo',
      name: 'card.jpg',
    });

    expect(attachedFile({ ...dentist, type: 'document', file_name: 'card.pdf' })).toStrictEqual({
      key: 'photos/2026/10/dentist.jpg',
      type: 'document',
      name: 'card.pdf',
    });

    const { r2_file_path: _key, ...unstored } = dentist;

    expect(attachedFile(unstored)).toBeUndefined();
    expect(attachedFile(page)).toBeUndefined();
    expect(attachedFile(tapas)).toBeUndefined();
  });
});

describe('getMemory', () => {
  const evaluated: MemoryPayload = {
    ...tapas,
    id: '55555555-5555-4555-8555-555555555555',
    source: 'eval',
  };

  const chunk = child('66666666-6666-4666-8666-666666666666', dentist);

  it('returns a readable parent by id and nothing else', async () => {
    const { store } = memoryFakes({ parents: [dentist, evaluated, chunk] });

    await expect(getMemory({ store, source: 'telegram' }, dentist.id)).resolves.toBe(dentist);
    await expect(getMemory({ store, source: 'mcp' }, dentist.id)).resolves.toBe(dentist);
    await expect(getMemory({ store, source: 'telegram' }, tapas.id)).resolves.toBeUndefined();
    await expect(getMemory({ store, source: 'telegram' }, chunk.id)).resolves.toBeUndefined();
    await expect(getMemory({ store, source: 'telegram' }, evaluated.id)).resolves.toBeUndefined();
    await expect(getMemory({ store, source: 'eval' }, evaluated.id)).resolves.toBe(evaluated);
  });
});

describe('fileLink', () => {
  it('pre-signs the stored file for the given lifetime and says when it expires', async () => {
    const { storage, presigned } = fakeStorage();

    await expect(
      fileLink(storage, { ...dentist, file_name: 'card.jpg' }, 900, () => NOW),
    ).resolves.toStrictEqual({
      url: 'https://signed.example/photos/2026/10/dentist.jpg',
      fileName: 'card.jpg',
      expiresAt: new Date('2026-11-12T12:15:00Z'),
    });

    await expect(
      fileLink(storage, { ...dentist, type: 'document' }, 60, () => NOW),
    ).resolves.toStrictEqual({
      url: 'https://signed.example/photos/2026/10/dentist.jpg',
      expiresAt: new Date('2026-11-12T12:01:00Z'),
    });

    expect(presigned).toStrictEqual([
      { key: 'photos/2026/10/dentist.jpg', expiresIn: 900 },
      { key: 'photos/2026/10/dentist.jpg', expiresIn: 60 },
    ]);
  });

  it('gives nothing for a memory without a stored file, and signs nothing', async () => {
    const { storage, presigned } = fakeStorage();

    await expect(fileLink(storage, tapas, 900)).resolves.toBeUndefined();
    await expect(fileLink(storage, page, 900)).resolves.toBeUndefined();
    expect(presigned).toStrictEqual([]);
  });
});
