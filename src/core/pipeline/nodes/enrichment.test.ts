import { describe, expect, it } from 'vitest';
import type { ChatModel, CompletionRequest, LlmRouter } from '../../llm/router.ts';
import type { Enrichment, IngestionStateType } from '../state.ts';
import { createEnrichmentNode } from './enrichment.ts';

const NOW = new Date('2026-10-12T09:30:00Z');

function state(overrides: Partial<IngestionStateType> = {}): IngestionStateType {
  return {
    source: 'telegram',
    id: '22222222-2222-4222-8222-222222222222',
    createdAt: 0,
    stored: { key: 'documents/2026/10/a.txt', contentType: 'text/plain' },
    originalText: 'first line\nsecond line',
    enrichment: undefined,
    payloads: [],
    message: {
      sourceRef: '10',
      chatRef: '7',
      userRef: '42',
      type: 'text',
      text: 'first line',
    },
    ...overrides,
  };
}

function router(reply: Record<string, unknown>): LlmRouter & { requests: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];

  const model: ChatModel = {
    id: 'fake-fast',
    complete() {
      return Promise.reject(new Error('enrichment uses structured output'));
    },
    object(request, schema) {
      requests.push(request);

      return Promise.resolve(schema.parse(reply));
    },
    run() {
      return Promise.reject(new Error('enrichment uses structured output'));
    },
  };

  return { requests, model: () => model };
}

const base = {
  summary: 'A note.',
  category: 'other',
  kind: 'note',
  tags: [] as string[],
};

async function enrich(
  reply: Record<string, unknown>,
  overrides?: Partial<IngestionStateType>,
): Promise<{ enrichment: Enrichment; prompt: string }> {
  const fake = router({ ...base, ...reply });
  const update = await createEnrichmentNode({ router: fake, now: () => NOW })(state(overrides));
  const enrichment = update.enrichment as Enrichment | undefined;

  if (enrichment === undefined) {
    throw new Error('the node must produce an enrichment');
  }

  const prompt = fake.requests[0]?.turns[0]?.parts[0];

  return { enrichment, prompt: prompt?.type === 'text' ? prompt.text : '' };
}

describe('createEnrichmentNode', () => {
  it('slugifies tags, drops duplicates, and drops a tag that repeats the category', async () => {
    const { enrichment } = await enrich({
      category: 'food',
      tags: ['Bar Pepe', '#food', 'bar pepe', '#tapas!', '  ', 'paella'],
    });

    expect(enrichment.tags).toEqual(['#bar_pepe', '#tapas', '#paella']);
  });

  it('caps the tag list even when the model ignores the instruction', async () => {
    const { enrichment } = await enrich({
      tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    });

    expect(enrichment.tags).toHaveLength(6);
  });

  it('drops an overlong tag instead of failing the save', async () => {
    const { enrichment } = await enrich({
      tags: ['#locksmith', `#${'very_long_tag_'.repeat(4)}`],
    });

    expect(enrichment.tags).toEqual(['#locksmith']);
  });

  it('turns an event date into midnight UTC and leaves it out otherwise', async () => {
    const dated = await enrich({ eventAt: '2026-11-03' });

    expect(dated.enrichment.eventAt).toBe(Math.floor(Date.parse('2026-11-03T00:00:00Z') / 1000));

    const undated = await enrich({});

    expect(undated.enrichment.eventAt).toBeUndefined();
  });

  it('omits a blank location rather than storing an empty string', async () => {
    const { enrichment } = await enrich({ location: '   ' });

    expect(enrichment.location).toBeUndefined();
  });

  it('falls back to the first line when the model returns a blank summary', async () => {
    const { enrichment } = await enrich({ summary: '   ' });

    expect(enrichment.summary).toBe('first line');
  });

  it('falls back to the file name when there is no text at all', async () => {
    const { enrichment } = await enrich(
      { summary: '' },
      {
        originalText: '',
        message: {
          ...state().message,
          type: 'document',
          text: '',
          file: { fileId: 'x', fileName: 'budget.xlsx' },
        },
      },
    );

    expect(enrichment.summary).toBe('budget.xlsx');
  });

  it('describes the item with its type, file name, and link before the content', async () => {
    const { prompt } = await enrich(
      {},
      {
        message: {
          ...state().message,
          type: 'url',
          text: 'https://example.com/a',
          sourceUrl: 'https://example.com/a',
        },
      },
    );

    expect(prompt).toContain('type: url');
    expect(prompt).toContain('link: https://example.com/a');
    expect(prompt).toContain('content:\nfirst line');
  });
});
