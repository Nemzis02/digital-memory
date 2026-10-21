import type { UUID } from 'node:crypto';

export const MEMORY_TAG = 'memory';

// A saved page that closes the fence itself could speak outside it, as if it were the system.
const CLOSER = new RegExp(`</(${MEMORY_TAG})`, 'gi');

/** Wraps memory text in a block the system prompt marks as content, never instructions. */
export function fenceMemory(id: UUID, text: string): string {
  const body = text.replaceAll(CLOSER, '&lt;/$1');

  return `<${MEMORY_TAG} id="${id}">\n${body}\n</${MEMORY_TAG}>`;
}
