import type { UUID } from 'node:crypto';
import type { Embeddings } from '../llm/embeddings.ts';
import { logger } from '../logging/logger.ts';
import type { MemoryCategory, MemoryKind, MemoryPayload, MemoryType } from '../memory/payload.ts';
import type { ObjectStorage } from '../storage/object-storage.ts';
import type { ListQuery, MemoryFilter, SearchHit, VectorStore } from '../vector/vector-store.ts';
import { NOTHING_FOUND, type Citation } from './answer.ts';

const log = logger.child({ module: 'retrieval/query' });

const SEARCH_LIMIT = 10;

// Default scroll page is 10, so a long note's leftover chunks would still match search().
const MAX_CHILDREN = 512;

/** A normalised query: dates are epoch days and tags are slugs. */
export interface QueryInput {
  query?: string;
  categories?: MemoryCategory[];
  kinds?: MemoryKind[];
  tags?: string[];
  types?: MemoryType[];
  location?: string;
  eventAfter?: number;
  eventBefore?: number;
  createdAfter?: number;
  createdBefore?: number;
  orderBy?: 'created_at' | 'event_at';
  direction?: 'asc' | 'desc';
}

function memoryFilter(input: QueryInput, isChild: boolean): MemoryFilter {
  return {
    isChild,
    ...(input.categories === undefined ? {} : { categories: input.categories }),
    ...(input.kinds === undefined ? {} : { kinds: input.kinds }),
    ...(input.tags === undefined ? {} : { tags: input.tags }),
    ...(input.types === undefined ? {} : { types: input.types }),
    ...(input.location === undefined ? {} : { location: input.location }),
    ...(input.eventAfter === undefined ? {} : { eventAfter: input.eventAfter }),
    ...(input.eventBefore === undefined ? {} : { eventBefore: input.eventBefore }),
    ...(input.createdAfter === undefined ? {} : { createdAfter: input.createdAfter }),
    ...(input.createdBefore === undefined ? {} : { createdBefore: input.createdBefore }),
  };
}

export async function recall(store: VectorStore, input: QueryInput): Promise<MemoryPayload[]> {
  const query: ListQuery = {
    // Children copy the parent's metadata, so a scroll without this returns each item once per chunk.
    filter: memoryFilter(input, false),
    ...(input.orderBy === undefined ? {} : { orderBy: input.orderBy }),
    ...(input.direction === undefined ? {} : { direction: input.direction }),
  };

  return store.list(query);
}

export interface SearchDeps {
  store: VectorStore;
  embeddings: Embeddings;
}

function requireQuery(input: QueryInput, fn: 'forget' | 'search'): string {
  const query = input.query?.trim();

  if (query === undefined || query === '') {
    throw new TypeError(`${fn}() needs a query`);
  }

  return query;
}

function parentIds(hits: readonly SearchHit[]): UUID[] {
  const ids: UUID[] = [];
  const seen = new Set<UUID>();

  for (const hit of hits) {
    const id = hit.payload.chunking.parent_id;

    if (id !== undefined && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }

  return ids;
}

function inHitOrder(ids: readonly UUID[], payloads: readonly MemoryPayload[]): MemoryPayload[] {
  const byId = new Map(payloads.map((payload) => [payload.id, payload]));
  const ordered: MemoryPayload[] = [];

  for (const id of ids) {
    const payload = byId.get(id);

    if (payload !== undefined) {
      ordered.push(payload);
    }
  }

  return ordered;
}

/** Hybrid search over children, returning their parents in hit order. */
export async function search(deps: SearchDeps, input: QueryInput): Promise<MemoryPayload[]> {
  const query = requireQuery(input, 'search');
  const dense = await deps.embeddings.embed(query, 'query');
  const sparse = deps.embeddings.embedSparse(query);

  const hits = await deps.store.search({
    dense,
    sparse,
    limit: SEARCH_LIMIT,
    filter: memoryFilter(input, true),
  });

  // The child is what matched; the parent is the text the model should read.
  const ids = parentIds(hits);

  if (ids.length === 0) {
    return [];
  }

  return inHitOrder(ids, await deps.store.fetch(ids));
}

/** Cites parents with a link for a saved page or the stored file for a photo or document. */
export function cite(parents: readonly MemoryPayload[]): Citation[] {
  return parents.map((parent) => {
    const cited = { id: parent.id, summary: parent.summary };
    const key = parent.r2_file_path;

    if (parent.type === 'url' && parent.source_url !== undefined) {
      return { ...cited, url: parent.source_url };
    }

    if ((parent.type === 'photo' || parent.type === 'document') && key !== undefined) {
      const name = parent.file_name;

      return {
        ...cited,
        file: { key, type: parent.type, ...(name === undefined ? {} : { name }) },
      };
    }

    return cited;
  });
}

const SOURCES = /^Sources:[ \t]*(.*)$/;

/** Strips a trailing `Sources:` line and keeps the parents it names, in their given order. */
export function usedParents(
  answer: string,
  parents: readonly MemoryPayload[],
): { answer: string; parents: MemoryPayload[] } {
  const lines = answer.split('\n');
  let last = lines.length - 1;

  while (last >= 0 && lines[last]?.trim() === '') {
    last -= 1;
  }

  const tail = lines[last];
  const match = tail === undefined ? null : SOURCES.exec(tail.trim());

  if (match === null) {
    const body = answer.trim();

    return { answer: body === NOTHING_FOUND ? NOTHING_FOUND : body, parents: [] };
  }

  const named = new Set((match[1] ?? '').split(/\s+/).filter((part) => part !== ''));
  const body = lines.slice(0, last).join('\n').trim();

  if (body === NOTHING_FOUND) {
    return { answer: NOTHING_FOUND, parents: [] };
  }

  return {
    answer: body,
    parents: parents.filter((parent) => named.has(parent.id)),
  };
}

export interface ResolveForgetDeps {
  store: VectorStore;
  embeddings: Embeddings;
}

export async function resolveForget(
  deps: ResolveForgetDeps,
  input: QueryInput,
): Promise<MemoryPayload | undefined> {
  const query = requireQuery(input, 'forget');
  const dense = await deps.embeddings.embed(query, 'query');
  const sparse = deps.embeddings.embedSparse(query);

  const hits = await deps.store.search({
    dense,
    sparse,
    limit: SEARCH_LIMIT,
    filter: memoryFilter(input, true),
  });

  const ranked = [...hits].sort((left, right) => right.score - left.score);
  const seen = new Set<UUID>();

  for (const hit of ranked) {
    const id = hit.payload.chunking.parent_id;

    if (id === undefined || seen.has(id)) {
      continue;
    }

    seen.add(id);

    const [parent] = await deps.store.fetch([id]);

    if (parent !== undefined) {
      return parent;
    }
  }

  return undefined;
}

export interface ForgetDeps {
  store: VectorStore;
  storage: ObjectStorage;
}

export async function forget(deps: ForgetDeps, parentId: UUID): Promise<boolean> {
  const [parent] = await deps.store.fetch([parentId]);

  if (parent === undefined || parent.chunking.is_child) {
    return false;
  }

  const children = await deps.store.list({ filter: { parentId }, limit: MAX_CHILDREN });
  const ids: UUID[] = [parentId, ...children.map((child) => child.id)];

  await deps.store.remove(ids);

  const key = parent.r2_file_path;

  if (key !== undefined) {
    await deps.storage.remove(key);
  }

  log.info('forgotten', { id: parentId, points: ids.length });

  return true;
}
