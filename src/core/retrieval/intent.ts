import type { ConversationTurn } from '../conversation/context.ts';
import type { MemoryCategory, MemoryKind, MemoryType } from '../memory/payload.ts';

export const INTENTS = ['save', 'ask', 'recall-by-filter', 'forget'] as const;

export type Intent = (typeof INTENTS)[number];

export interface ClassificationInput {
  text: string;
  context: readonly ConversationTurn[];
}

export interface IntentSlots {
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

export interface ClassifiedIntent {
  intent: Intent;
  slots: IntentSlots;
}

export interface IntentClassifier {
  classify(input: ClassificationInput): Promise<ClassifiedIntent>;
}

export function stubIntentClassifier(): IntentClassifier {
  return {
    // Guessing `ask` from the wording would drop notes. The undo button is the recovery.
    classify() {
      return Promise.resolve({ intent: 'save', slots: {} });
    },
  };
}
