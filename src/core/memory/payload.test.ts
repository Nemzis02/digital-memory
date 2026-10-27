import { describe, expect, it } from 'vitest';
import { parseMemoryPayload } from './payload.ts';

const valid = {
  id: '3f0c6f0e-2d1a-4f6b-9f1e-8c4b2a7d5e10',
  source: 'telegram',
  source_ref: '4242',
  type: 'photo',
  original_text: 'paella at Casa Carmela',
  summary: 'Paella lunch at Casa Carmela',
  r2_file_path: 'photos/2026/03/3f0c6f0e-2d1a-4f6b-9f1e-8c4b2a7d5e10.jpg',
  metadata: { category: 'food', kind: 'recommendation', location: 'Valencia', tags: ['#paella'] },
  chunking: { is_child: false },
  created_at: 1_772_000_000,
};

describe('parseMemoryPayload', () => {
  it('accepts a full payload unchanged', () => {
    expect(parseMemoryPayload(valid)).toStrictEqual(valid);
  });

  it('drops keys the store does not know about', () => {
    expect(() => parseMemoryPayload({ ...valid, mood: 'happy' })).toThrow(/mood/);
  });

  it('rejects a category outside the enum the enrichment node may emit', () => {
    expect(() =>
      parseMemoryPayload({ ...valid, metadata: { category: 'sports', kind: 'note', tags: [] } }),
    ).toThrow(TypeError);
  });

  it('rejects a url memory that lost its link', () => {
    expect(() => parseMemoryPayload({ ...valid, type: 'url' })).toThrow(/must keep its link/);
  });

  it('keeps the link and the date the thing happens on', () => {
    const appointment = {
      ...valid,
      type: 'url',
      source_url: 'https://sede.administracion.gob.es/icpplus',
      metadata: { category: 'bureaucracy', kind: 'event', tags: ['#cita_previa'] },
      event_at: 1_772_500_000,
    };

    expect(parseMemoryPayload(appointment)).toStrictEqual(appointment);
  });

  it('rejects a memory with no summary to show in the confirmation', () => {
    expect(() => parseMemoryPayload({ ...valid, summary: '' })).toThrow(TypeError);
  });

  it('rejects an orphan child chunk', () => {
    expect(() => parseMemoryPayload({ ...valid, chunking: { is_child: true } })).toThrow(
      /is_child and parent_id/,
    );
  });

  it('rejects a parent carrying a parent_id', () => {
    expect(() =>
      parseMemoryPayload({
        ...valid,
        chunking: { is_child: false, parent_id: '8c4b2a7d-5e10-4f6b-9f1e-3f0c6f0e2d1a' },
      }),
    ).toThrow(/is_child and parent_id/);
  });

  it('accepts a child that names its parent', () => {
    const child = {
      ...valid,
      chunking: { is_child: true, parent_id: '8c4b2a7d-5e10-4f6b-9f1e-3f0c6f0e2d1a' },
    };

    expect(parseMemoryPayload(child)).toStrictEqual(child);
  });

  it('accepts a memory ingested through MCP, which has no Telegram message', () => {
    const fromEditor = {
      ...valid,
      source: 'mcp',
      source_ref: 'sha256:9f2c',
      type: 'text',
      r2_file_path: undefined,
      metadata: { category: 'work', kind: 'reference', tags: ['#snippet'] },
    };

    expect(parseMemoryPayload(fromEditor).source).toBe('mcp');
  });

  it('accepts a memory seeded by the eval run', () => {
    expect(parseMemoryPayload({ ...valid, source: 'eval' }).source).toBe('eval');
  });

  it('keeps the sender file name of a stored document', () => {
    const document = { ...valid, type: 'document', file_name: 'Программа 2023.pdf' };

    expect(parseMemoryPayload(document)).toStrictEqual(document);
  });

  it('rejects a file name with no stored object to name', () => {
    expect(() =>
      parseMemoryPayload({ ...valid, r2_file_path: undefined, file_name: 'card.pdf' }),
    ).toThrow(/needs r2_file_path/);
  });

  it('rejects an empty file name', () => {
    expect(() => parseMemoryPayload({ ...valid, file_name: '' })).toThrow(TypeError);
  });

  it('rejects a point id Qdrant would refuse', () => {
    expect(() => parseMemoryPayload({ ...valid, id: 'msg-1' })).toThrow(TypeError);
  });
});
