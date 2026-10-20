import type { UUID } from 'node:crypto';
import { Annotation } from '@langchain/langgraph';
import type { InboundMessage } from '../ingestion/inbound.ts';
import type { MemoryCategory, MemoryKind, MemoryPayload, MemorySource } from '../memory/payload.ts';

export interface StoredFile {
  key: string;
  contentType: string;
  fileName?: string;
}

export interface Enrichment {
  summary: string;
  category: MemoryCategory;
  kind: MemoryKind;
  location?: string;
  tags: string[];
  eventAt?: number;
}

function last<T>(_current: T, next: T): T {
  return next;
}

export const IngestionState = Annotation.Root({
  source: Annotation<MemorySource>,
  message: Annotation<InboundMessage>,
  id: Annotation<UUID>,
  createdAt: Annotation<number>,
  stored: Annotation<StoredFile | undefined>({ reducer: last, default: () => undefined }),
  originalText: Annotation<string>({ reducer: last, default: () => '' }),
  enrichment: Annotation<Enrichment | undefined>({ reducer: last, default: () => undefined }),
  payloads: Annotation<MemoryPayload[]>({ reducer: last, default: () => [] }),
});

export type IngestionStateType = typeof IngestionState.State;

export type IngestionUpdate = typeof IngestionState.Update;

export interface IngestionInput {
  source: MemorySource;
  message: InboundMessage;
}

export function requireStored(state: IngestionStateType): StoredFile {
  if (state.stored === undefined) {
    throw new Error('The file handler must run before the object can be read back');
  }

  return state.stored;
}

export function requireEnrichment(state: IngestionStateType): Enrichment {
  if (state.enrichment === undefined) {
    throw new Error('Enrichment must run before a payload can be built');
  }

  return state.enrichment;
}
