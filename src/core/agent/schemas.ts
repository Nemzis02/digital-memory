import { z } from 'zod';
import { epochDay, tagSlug } from '../memory/normalize.ts';
import { MEMORY_CATEGORIES, MEMORY_KINDS, MEMORY_TYPES } from '../memory/payload.ts';
import type { QueryInput } from '../retrieval/query.ts';

const MAX_TAGS = 6;

// No transforms: the MCP server validates against these same schemas, and the model is shown
// their JSON Schema, which a transform cannot be expressed in.
export const memoryFilterSchema = z.object({
  categories: z
    .array(z.enum(MEMORY_CATEGORIES))
    .optional()
    .describe('Life domains to keep. Only when the user names one.'),
  kinds: z
    .array(z.enum(MEMORY_KINDS))
    .optional()
    .describe('What the memory is for, independent of its domain. Only when the user names one.'),
  tags: z
    .array(z.string().max(40))
    .optional()
    .describe(
      `Lowercase, prefixed with #, no spaces, at most ${String(MAX_TAGS)}, never a category name.`,
    ),
  types: z
    .array(z.enum(MEMORY_TYPES))
    .optional()
    .describe('The form it was saved in. Only when the user names one.'),
  location: z
    .string()
    .max(120)
    .optional()
    .describe('A city or venue the memory is about. Only when the user names one.'),
  eventAfter: z.iso
    .date()
    .optional()
    .describe(
      'Earliest date the memory is about (an appointment, a deadline), YYYY-MM-DD. "Coming up" starts today.',
    ),
  eventBefore: z.iso
    .date()
    .optional()
    .describe('Latest date the memory is about, YYYY-MM-DD. "Coming up" has no end.'),
  createdAfter: z.iso.date().optional().describe('Earliest day it was saved, YYYY-MM-DD.'),
  createdBefore: z.iso.date().optional().describe('Latest day it was saved, YYYY-MM-DD.'),
});

export const searchMemoryInput = memoryFilterSchema.extend({
  query: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe('One standalone phrase that does not depend on earlier turns.'),
});

export const listMemoriesInput = memoryFilterSchema.extend({
  orderBy: z
    .enum(['created_at', 'event_at'])
    .optional()
    .describe(
      'event_at for the dates memories are about, created_at for when they were saved. Omit when no order is asked for.',
    ),
  direction: z
    .enum(['asc', 'desc'])
    .optional()
    .describe('asc for what comes next, desc for the latest.'),
});

export const forgetMemoryInput = searchMemoryInput;

export const saveMemoryInput = z.object({
  note: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .optional()
    .describe(
      "What to keep, in the user's words, when only part of the message is meant to be saved. Omit to save the message as sent.",
    ),
});

export type MemoryFilterInput = z.infer<typeof memoryFilterSchema>;
export type SearchMemoryInput = z.infer<typeof searchMemoryInput>;
export type ListMemoriesInput = z.infer<typeof listMemoriesInput>;
export type ForgetMemoryInput = z.infer<typeof forgetMemoryInput>;
export type SaveMemoryInput = z.infer<typeof saveMemoryInput>;

type ToolQueryInput = MemoryFilterInput &
  Partial<Pick<ListMemoriesInput, 'orderBy' | 'direction'>> & {
    query?: string | undefined;
  };

function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

function present<T>(values: readonly T[] | undefined): T[] | undefined {
  return values === undefined || values.length === 0 ? undefined : [...values];
}

function bound(date: string | undefined): number | undefined {
  return date === undefined ? undefined : epochDay(date);
}

function tags(raw: readonly string[], categories: readonly string[]): string[] {
  const blocked = new Set(categories.map((category) => `#${category}`));
  const seen = new Set<string>();

  for (const candidate of raw) {
    const normalized = tagSlug(candidate);

    if (normalized !== '' && !blocked.has(normalized)) {
      seen.add(normalized);
    }
  }

  return [...seen].slice(0, MAX_TAGS);
}

/** Maps tool input onto the query `search()`, `recall()` and `resolveForget()` take. */
export function toQueryInput(input: ToolQueryInput): QueryInput {
  const query = text(input.query);
  const categories = present(input.categories);
  const kinds = present(input.kinds);
  const types = present(input.types);

  const filledTags = present(
    input.tags === undefined ? undefined : tags(input.tags, categories ?? []),
  );

  const location = text(input.location);
  const eventAfter = bound(input.eventAfter);
  const eventBefore = bound(input.eventBefore);
  const createdAfter = bound(input.createdAfter);
  const createdBefore = bound(input.createdBefore);

  return {
    ...(query === undefined ? {} : { query }),
    ...(categories === undefined ? {} : { categories }),
    ...(kinds === undefined ? {} : { kinds }),
    ...(filledTags === undefined ? {} : { tags: filledTags }),
    ...(types === undefined ? {} : { types }),
    ...(location === undefined ? {} : { location }),
    ...(eventAfter === undefined ? {} : { eventAfter }),
    ...(eventBefore === undefined ? {} : { eventBefore }),
    ...(createdAfter === undefined ? {} : { createdAfter }),
    ...(createdBefore === undefined ? {} : { createdBefore }),
    ...(input.orderBy === undefined ? {} : { orderBy: input.orderBy }),
    ...(input.direction === undefined ? {} : { direction: input.direction }),
  };
}
