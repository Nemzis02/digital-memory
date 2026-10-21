import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MEMORY_CATEGORIES } from '../memory/payload.ts';
import { listMemoriesInput, saveMemoryInput, searchMemoryInput, toQueryInput } from './schemas.ts';

describe('toQueryInput', () => {
  it('maps dates to UTC midnight and keeps order and direction', () => {
    const input = listMemoriesInput.parse({
      kinds: ['event'],
      eventAfter: '2026-10-21',
      eventBefore: '2026-10-28',
      createdAfter: '2026-01-01',
      createdBefore: '2026-12-31',
      orderBy: 'event_at',
      direction: 'asc',
    });

    expect(toQueryInput(input)).toStrictEqual({
      kinds: ['event'],
      eventAfter: Date.UTC(2026, 9, 21) / 1000,
      eventBefore: Date.UTC(2026, 9, 28) / 1000,
      createdAfter: Date.UTC(2026, 0, 1) / 1000,
      createdBefore: Date.UTC(2026, 11, 31) / 1000,
      orderBy: 'event_at',
      direction: 'asc',
    });
  });

  it('trims the query and location and drops what is blank or empty', () => {
    const input = searchMemoryInput.parse({
      query: '  tapas in Valencia  ',
      location: '   ',
      categories: [],
      kinds: [],
      types: [],
      tags: [],
    });

    expect(toQueryInput(input)).toStrictEqual({ query: 'tapas in Valencia' });
  });

  it('slugs tags, drops one that repeats a category, and caps them at six', () => {
    const input = searchMemoryInput.parse({
      query: 'receipts',
      categories: ['finance'],
      tags: ['Finance', 'Bar Pepe', '#bar_pepe', '!!!', 'a', 'b', 'c', 'd', 'e', 'f'],
    });

    expect(toQueryInput(input)).toStrictEqual({
      query: 'receipts',
      categories: ['finance'],
      tags: ['#bar_pepe', '#a', '#b', '#c', '#d', '#e'],
    });
  });

  it('maps an empty listing to an empty query', () => {
    expect(toQueryInput(listMemoriesInput.parse({}))).toStrictEqual({});
  });
});

describe('input schemas', () => {
  it('reject a category outside the archive, a loose date, and a blank query', () => {
    expect(searchMemoryInput.safeParse({ query: 'x', categories: ['astrology'] }).success).toBe(
      false,
    );

    expect(listMemoriesInput.safeParse({ eventAfter: 'next tuesday' }).success).toBe(false);
    expect(searchMemoryInput.safeParse({ query: '   ' }).success).toBe(false);
    expect(saveMemoryInput.safeParse({ note: '  ' }).success).toBe(false);
  });

  it('show the model a query it must give and dates as strings', () => {
    const schema = z.toJSONSchema(searchMemoryInput, { io: 'input', target: 'draft-7' });

    expect(schema).toMatchObject({
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        eventAfter: { type: 'string', format: 'date' },
        categories: { type: 'array', items: { enum: [...MEMORY_CATEGORIES] } },
      },
    });
  });
});
