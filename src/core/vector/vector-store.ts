import type { UUID } from 'node:crypto';
import type {
  MemoryCategory,
  MemoryKind,
  MemoryPayload,
  MemorySource,
  MemoryType,
} from '../memory/payload.ts';

export const DENSE_VECTOR_SIZE = 1536;

export interface SparseVector {
  indices: number[];
  values: number[];
}

export interface MemoryRecord {
  payload: MemoryPayload;
  dense: number[];
  sparse?: SparseVector;
}

export interface MemoryFilter {
  sources?: MemorySource[];
  sourceRef?: string;
  types?: MemoryType[];
  categories?: MemoryCategory[];
  kinds?: MemoryKind[];
  tags?: string[];
  location?: string;
  sourceUrl?: string;
  isChild?: boolean;
  parentId?: UUID;
  createdAfter?: number;
  createdBefore?: number;
  eventAfter?: number;
  eventBefore?: number;
}

export interface SearchQuery {
  dense?: number[];
  sparse?: SparseVector;
  filter?: MemoryFilter;
  limit?: number;
}

export interface ListQuery {
  filter?: MemoryFilter;
  orderBy?: 'created_at' | 'event_at';
  direction?: 'asc' | 'desc';
  limit?: number;
}

export interface SearchHit {
  id: UUID;
  score: number;
  payload: MemoryPayload;
}

export interface VectorStore {
  init(): Promise<void>;
  upsert(records: MemoryRecord[]): Promise<void>;
  search(query: SearchQuery): Promise<SearchHit[]>;
  // Ordering by a field also drops records that lack it, which is what "upcoming" needs.
  list(query: ListQuery): Promise<MemoryPayload[]>;
  fetch(ids: UUID[]): Promise<MemoryPayload[]>;
  remove(ids: UUID[]): Promise<void>;
}
