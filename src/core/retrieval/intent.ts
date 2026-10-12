import type { ConversationTurn } from '../conversation/context.ts';

export const INTENTS = ['save', 'ask', 'recall-by-filter', 'forget'] as const;

export type Intent = (typeof INTENTS)[number];

export interface ClassificationInput {
  text: string;
  context: readonly ConversationTurn[];
}

export interface ClassifiedIntent {
  intent: Intent;
}

export interface IntentClassifier {
  classify(input: ClassificationInput): Promise<ClassifiedIntent>;
}

export function stubIntentClassifier(): IntentClassifier {
  return {
    // Guessing `ask` from the wording would drop notes. The undo button is the recovery.
    classify() {
      return Promise.resolve({ intent: 'save' });
    },
  };
}
