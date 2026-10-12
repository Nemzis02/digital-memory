import { describe, expect, it } from 'vitest';
import { stubIntentClassifier } from './intent.ts';

describe('stubIntentClassifier', () => {
  it('saves every message until a model exists', async () => {
    await expect(
      stubIntentClassifier().classify({ text: 'what is coming up?', context: [] }),
    ).resolves.toEqual({
      intent: 'save',
    });
  });
});
