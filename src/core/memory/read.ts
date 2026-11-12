import type { UUID } from 'node:crypto';
import type { ObjectStorage } from '../storage/object-storage.ts';
import type { VectorStore } from '../vector/vector-store.ts';
import {
  readableSources,
  type MemoryPayload,
  type MemorySource,
  type MemoryType,
} from './payload.ts';

export const MEMORY_TAG = 'memory';

// A saved page that closes the fence itself could speak outside it, as if it were the system.
const CLOSER = new RegExp(`</(${MEMORY_TAG})`, 'gi');

/** Wraps memory text in a block the prompts mark as content, never instructions. */
export function fenceMemory(id: UUID, text: string): string {
  const body = text.replaceAll(CLOSER, '&lt;/$1');

  return `<${MEMORY_TAG} id="${id}">\n${body}\n</${MEMORY_TAG}>`;
}

export interface ListedMemory {
  id: UUID;
  summary: string;
  type: MemoryType;
  created_at: string;
  event_at?: string;
}

export interface FoundMemory extends ListedMemory {
  has_file: boolean;
  url?: string;
  text: string;
}

export interface AttachedFile {
  key: string;
  type: 'photo' | 'document';
  name?: string;
}

export function day(epoch: number): string {
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

/** The stored object a photo or document can be sent as; a url memory's saved page is not one. */
export function attachedFile(memory: MemoryPayload): AttachedFile | undefined {
  const key = memory.r2_file_path;

  if ((memory.type !== 'photo' && memory.type !== 'document') || key === undefined) {
    return undefined;
  }

  return {
    key,
    type: memory.type,
    ...(memory.file_name === undefined ? {} : { name: memory.file_name }),
  };
}

export function listed(memory: MemoryPayload): ListedMemory {
  return {
    id: memory.id,
    summary: memory.summary,
    type: memory.type,
    created_at: day(memory.created_at),
    ...(memory.event_at === undefined ? {} : { event_at: day(memory.event_at) }),
  };
}

export function found(memory: MemoryPayload): FoundMemory {
  return {
    ...listed(memory),
    has_file: attachedFile(memory) !== undefined,
    ...(memory.type === 'url' && memory.source_url !== undefined ? { url: memory.source_url } : {}),
    text: fenceMemory(memory.id, memory.original_text),
  };
}

export interface ReadDeps {
  store: VectorStore;
  source: MemorySource;
}

/** One parent by id, when it exists and `source` may read it. */
export async function getMemory(deps: ReadDeps, id: UUID): Promise<MemoryPayload | undefined> {
  const sources = readableSources(deps.source);
  const payloads = await deps.store.fetch([id]);

  return payloads.find(
    (payload) =>
      payload.id === id && !payload.chunking.is_child && sources.includes(payload.source),
  );
}

export interface FileLink {
  url: string;
  fileName?: string;
  expiresAt: Date;
}

/** A pre-signed link for the memory's stored file; undefined when it has none. */
export async function fileLink(
  storage: ObjectStorage,
  memory: MemoryPayload,
  ttlSeconds: number,
  now: () => Date = () => new Date(),
): Promise<FileLink | undefined> {
  const file = attachedFile(memory);

  if (file === undefined) {
    return undefined;
  }

  const url = await storage.presignDownload(file.key, ttlSeconds);

  return {
    url,
    ...(file.name === undefined ? {} : { fileName: file.name }),
    expiresAt: new Date(now().getTime() + ttlSeconds * 1000),
  };
}
