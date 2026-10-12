import { describe, expect, it } from 'vitest';
import { CHUNK_CHARS, splitText } from './chunk.ts';

describe('splitText', () => {
  it('returns nothing for blank text and one chunk for short text', () => {
    expect(splitText('   \n  ')).toEqual([]);
    expect(splitText('  buy milk  ')).toEqual(['buy milk']);
  });

  it('keeps every chunk within the limit and loses no words', () => {
    const paragraph = `${'word '.repeat(40).trim()}.`;
    const text = Array.from({ length: 20 }, () => paragraph).join('\n\n');

    const chunks = splitText(text);

    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_CHARS);
    }

    const joined = chunks.join(' ').replaceAll(/\s+/g, ' ');

    expect(joined).toContain(paragraph);
  });

  it('overlaps consecutive chunks so a sentence split across them stays findable', () => {
    const chunks = splitText('alpha bravo charlie delta echo foxtrot golf hotel', 20, 10);

    expect(chunks.length).toBeGreaterThan(1);

    const first = chunks[0] ?? '';
    const second = chunks[1] ?? '';
    const shared = first.split(' ').filter((word) => second.split(' ').includes(word));

    expect(shared.length).toBeGreaterThan(0);
  });

  it('hard splits a run with no separator at all', () => {
    const chunks = splitText('a'.repeat(50), 20, 0);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(20);
    expect(chunks.join('')).toBe('a'.repeat(50));
  });

  it('splits on a newline when there is no blank line', () => {
    const line = `${'x'.repeat(30)}\n`;
    const chunks = splitText(line.repeat(10), 50, 0);

    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(50);
    }
  });
});
