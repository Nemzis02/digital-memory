import { describe, expect, it } from 'vitest';
import { DENSE_VECTOR_SIZE } from '../vector/vector-store.ts';
import { createEmbeddings } from './embeddings.ts';
import { createRouter } from './router.ts';

const live = process.env.LLM_LIVE === '1' && (process.env.LLM_FAST_API_KEY?.length ?? 0) > 0;

describe.skipIf(!live)('live model smoke', () => {
  it('embeds one short string at the collection width', async () => {
    const vector = await createEmbeddings().embed('ping', 'query');

    expect(vector).toHaveLength(DENSE_VECTOR_SIZE);
  });

  it('completes one short reply on the fast model', async () => {
    const text = await createRouter()
      .model('fast')
      .complete({
        system: 'Reply with the single word pong.',
        turns: [{ role: 'user', parts: [{ type: 'text', text: 'ping' }] }],
      });

    expect(text.length).toBeGreaterThan(0);
  });
});
