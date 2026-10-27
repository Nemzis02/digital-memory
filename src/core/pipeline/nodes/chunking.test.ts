import { describe, expect, it } from 'vitest';
import { chunkId } from '../../memory/id.ts';
import { parseMemoryPayload } from '../../memory/payload.ts';
import { CHUNK_CHARS } from '../chunk.ts';
import { chunkPayloads } from './chunking.ts';

const parent = parseMemoryPayload({
  id: '22222222-2222-4222-8222-222222222222',
  source: 'eval',
  source_ref: 'tapas',
  type: 'url',
  original_text: 'Bar Central serves tapas.',
  summary: 'Tapas at Bar Central',
  source_url: 'https://example.com/bar-central',
  metadata: { category: 'food', kind: 'recommendation', tags: ['#tapas'] },
  chunking: { is_child: false },
  created_at: 0,
});

describe('chunkPayloads', () => {
  it('puts the parent first and gives a short text one child that copies it', () => {
    expect(chunkPayloads(parent)).toStrictEqual([
      parent,
      {
        ...parent,
        id: chunkId(parent.id, 0),
        chunking: { is_child: true, parent_id: parent.id },
      },
    ]);
  });

  it('splits a long text into numbered children', () => {
    const long = { ...parent, original_text: 'word '.repeat(CHUNK_CHARS) };
    const [, ...children] = chunkPayloads(long);

    expect(children.length).toBeGreaterThan(1);

    expect(children.map((child) => child.id)).toStrictEqual(
      children.map((_, index) => chunkId(parent.id, index)),
    );
  });
});
