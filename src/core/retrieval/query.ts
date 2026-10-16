import type { MemoryPayload } from '../memory/payload.ts';
import type { ListQuery, VectorStore } from '../vector/vector-store.ts';
import type { IntentSlots } from './intent.ts';

export async function recall(store: VectorStore, slots: IntentSlots): Promise<MemoryPayload[]> {
  const query: ListQuery = {
    // Children copy the parent's metadata, so a scroll without this returns each item once per chunk.
    filter: {
      isChild: false,
      ...(slots.categories === undefined ? {} : { categories: slots.categories }),
      ...(slots.kinds === undefined ? {} : { kinds: slots.kinds }),
      ...(slots.tags === undefined ? {} : { tags: slots.tags }),
      ...(slots.types === undefined ? {} : { types: slots.types }),
      ...(slots.location === undefined ? {} : { location: slots.location }),
      ...(slots.eventAfter === undefined ? {} : { eventAfter: slots.eventAfter }),
      ...(slots.eventBefore === undefined ? {} : { eventBefore: slots.eventBefore }),
      ...(slots.createdAfter === undefined ? {} : { createdAfter: slots.createdAfter }),
      ...(slots.createdBefore === undefined ? {} : { createdBefore: slots.createdBefore }),
    },
    ...(slots.orderBy === undefined ? {} : { orderBy: slots.orderBy }),
    ...(slots.direction === undefined ? {} : { direction: slots.direction }),
  };

  return store.list(query);
}
