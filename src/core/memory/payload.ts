import type { UUID } from 'node:crypto';
import { z } from 'zod';

const uuid = z.uuid().transform((value) => value as UUID);

export const MEMORY_TYPES = ['text', 'photo', 'document', 'url', 'voice'] as const;

export const MEMORY_SOURCES = ['telegram', 'mcp'] as const;

export const MEMORY_CATEGORIES = [
  'food',
  'bureaucracy',
  'housing',
  'finance',
  'health',
  'work',
  'travel',
  'transport',
  'shopping',
  'leisure',
  'learning',
  'people',
  'other',
] as const;

export const MEMORY_KINDS = [
  'reference',
  'event',
  'task',
  'receipt',
  'credential',
  'recommendation',
  'idea',
  'note',
] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

export type MemorySource = (typeof MEMORY_SOURCES)[number];

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const memoryPayloadSchema = z
  .strictObject({
    id: uuid,
    source: z.enum(MEMORY_SOURCES),
    source_ref: z.string().min(1),
    type: z.enum(MEMORY_TYPES),
    original_text: z.string(),
    summary: z.string().min(1),
    source_url: z.url().optional(),
    r2_file_path: z.string().min(1).optional(),
    file_name: z.string().min(1).max(255).optional(),
    metadata: z.strictObject({
      category: z.enum(MEMORY_CATEGORIES),
      kind: z.enum(MEMORY_KINDS),
      location: z.string().min(1).optional(),
      tags: z.array(z.string().min(1)),
    }),
    chunking: z.strictObject({
      is_child: z.boolean(),
      parent_id: uuid.optional(),
    }),
    created_at: z.number().int().nonnegative(),
    event_at: z.number().int().nonnegative().optional(),
  })
  .refine((payload) => payload.chunking.is_child === (payload.chunking.parent_id !== undefined), {
    error: 'is_child and parent_id must agree: a child points at a parent, a parent at nothing',
    path: ['chunking'],
  })
  .refine((payload) => payload.file_name === undefined || payload.r2_file_path !== undefined, {
    error: 'a file name names a stored object, so it needs r2_file_path',
    path: ['file_name'],
  })
  .refine((payload) => payload.type !== 'url' || payload.source_url !== undefined, {
    error: 'a url memory must keep its link: original_text holds the scrape, not the address',
    path: ['source_url'],
  });

export type MemoryPayload = z.infer<typeof memoryPayloadSchema>;

export function parseMemoryPayload(value: unknown): MemoryPayload {
  const result = memoryPayloadSchema.safeParse(value);

  if (!result.success) {
    throw new TypeError(`Invalid memory payload:\n${z.prettifyError(result.error)}`);
  }

  return result.data;
}
