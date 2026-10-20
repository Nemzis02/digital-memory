import type { UUID } from 'node:crypto';

export const NOTHING_FOUND = 'nothing found';

export interface CitationFile {
  key: string;
  type: 'photo' | 'document';
  name?: string;
}

export interface Citation {
  id: UUID;
  summary: string;
  url?: string;
  file?: CitationFile;
}

export interface Answer {
  answer: string;
  citations: Citation[];
}
