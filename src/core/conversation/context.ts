export const CONTEXT_GAP_MS = 30 * 60 * 1000;
export const CONTEXT_TURN_LIMIT = 20;

export interface ConversationTurn {
  role: 'user' | 'assistant';
  body: string;
  sourceRef?: string;
  createdAt: Date;
}

export function contextWindow(
  turns: readonly ConversationTurn[],
  now: Date,
  replyToSourceRef?: string,
): ConversationTurn[] {
  const selected: ConversationTurn[] = [];
  let previous = now.getTime();

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];

    if (turn === undefined || previous - turn.createdAt.getTime() > CONTEXT_GAP_MS) {
      break;
    }

    selected.push(turn);
    previous = turn.createdAt.getTime();

    if (selected.length >= CONTEXT_TURN_LIMIT) {
      break;
    }
  }

  selected.reverse();

  if (
    replyToSourceRef === undefined ||
    selected.some((turn) => turn.sourceRef === replyToSourceRef)
  ) {
    return selected;
  }

  const replied = turns.find((turn) => turn.sourceRef === replyToSourceRef);

  return replied === undefined ? selected : [replied, ...selected];
}
