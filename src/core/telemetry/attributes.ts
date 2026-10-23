import { createHash } from 'node:crypto';
import type { MemorySource } from '../memory/payload.ts';

export const TURN_OUTCOMES = [
  'answer',
  'saved',
  'forget',
  'step-limit',
  'timeout',
  'error',
] as const;

export type TurnOutcome = (typeof TURN_OUTCOMES)[number];

export interface TurnIdentity {
  source: MemorySource;
  chatRef: string;
  userRef: string;
}

export interface TurnAttributes {
  userId: string;
  sessionId: string;
  tags: string[];
  metadata: { source: MemorySource; chat: string };
}

const HASH_CHARS = 16;

export function hashRef(ref: string): string {
  return createHash('sha256').update(ref, 'utf8').digest('hex').slice(0, HASH_CHARS);
}

export function turnAttributes(identity: TurnIdentity): TurnAttributes {
  const chat = hashRef(identity.chatRef);

  return {
    userId: hashRef(identity.userRef),
    sessionId: chat,
    tags: [identity.source],
    metadata: { source: identity.source, chat },
  };
}
