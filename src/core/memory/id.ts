import type { UUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import type { MemorySource } from './payload.ts';

const NAMESPACE = 'a6f8c3f2-5c3b-4a4f-9a1c-0d7b2e6f8c91';

function uuidV5(name: string): UUID {
  const hash = createHash('sha1')
    .update(Buffer.from(NAMESPACE.replaceAll('-', ''), 'hex'))
    .update(name, 'utf8')
    .digest();

  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50;
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;

  const hex = hash.subarray(0, 16).toString('hex');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function memoryId(source: MemorySource, ref: string): UUID {
  return uuidV5(`${source}:${ref}`);
}

export function chunkId(parent: UUID, index: number): UUID {
  return uuidV5(`${parent}#${index}`);
}
