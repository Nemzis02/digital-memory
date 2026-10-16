import type { UUID } from 'node:crypto';

export const NOTHING_FOUND = 'nothing found';

export interface Citation {
  id: UUID;
  summary: string;
  url?: string;
}

export interface Answer {
  answer: string;
  citations: Citation[];
}
