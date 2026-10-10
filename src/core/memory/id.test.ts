import { describe, expect, it } from 'vitest';
import { chunkId, memoryId } from './id.ts';

const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('memoryId', () => {
  it('mints a well-formed v5 uuid', () => {
    expect(memoryId('telegram', '4242')).toMatch(UUID_V5);
  });

  it('is stable, so a redelivered update overwrites its own point', () => {
    expect(memoryId('telegram', '4242')).toBe(memoryId('telegram', '4242'));
  });

  it('keeps the two transports from colliding on the same ref', () => {
    expect(memoryId('telegram', '4242')).not.toBe(memoryId('mcp', '4242'));
  });
});

describe('chunkId', () => {
  it('derives a distinct, stable id per chunk of a parent', () => {
    const parent = memoryId('mcp', 'sha256:abc');

    expect(chunkId(parent, 0)).toBe(chunkId(parent, 0));
    expect(chunkId(parent, 0)).not.toBe(chunkId(parent, 1));
    expect(chunkId(parent, 0)).not.toBe(parent);
  });
});
