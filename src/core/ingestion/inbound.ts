import type { MemoryType } from '../memory/payload.ts';

export interface InboundFile {
  fileId: string;
  fileName?: string;
  mimeType?: string;
}

export interface InboundMessage {
  sourceRef: string;
  chatRef: string;
  userRef: string;
  displayName?: string;
  type: MemoryType;
  text: string;
  sourceUrl?: string;
  file?: InboundFile;
  replyToSourceRef?: string;
}

export function turnBody(message: InboundMessage): string {
  const text = message.text.trim();

  return text === '' ? `[${message.type}]` : text;
}
