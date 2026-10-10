import { describe, expect, it } from 'vitest';
import { CONTEXT_GAP_MS, CONTEXT_TURN_LIMIT, contextWindow } from './context.ts';
import type { ConversationTurn } from './context.ts';

const at = (minutes: number, body: string, sourceRef?: string): ConversationTurn => ({
  role: body.startsWith('bot:') ? 'assistant' : 'user',
  body,
  createdAt: new Date(Date.UTC(2026, 2, 9, 12, minutes, 0)),
  ...(sourceRef === undefined ? {} : { sourceRef }),
});

const noon = new Date(Date.UTC(2026, 2, 9, 12, 0, 0));

describe('contextWindow', () => {
  it('returns nothing when the chat has been quiet', () => {
    const turns = [at(0, 'where is the appointment?', '1')];

    expect(contextWindow(turns, new Date(noon.getTime() + CONTEXT_GAP_MS + 1))).toEqual([]);
  });

  it('keeps a follow-up sent as a new message, without a Telegram reply', () => {
    const turns = [at(0, 'where is the appointment?', '1'), at(1, 'bot: 17 March, Valencia', '2')];

    expect(
      contextWindow(turns, new Date(noon.getTime() + 2 * 60 * 1000)).map((turn) => turn.body),
    ).toEqual(['where is the appointment?', 'bot: 17 March, Valencia']);
  });

  it('stops at the gap, so a later topic does not drag the earlier one back', () => {
    const turns = [
      at(0, 'where is the appointment?', '1'),
      at(1, 'bot: 17 March', '2'),
      at(40, 'save this menu', '3'),
    ];

    expect(
      contextWindow(turns, new Date(noon.getTime() + 41 * 60 * 1000)).map((turn) => turn.sourceRef),
    ).toEqual(['3']);
  });

  it('caps the window so a long sitting cannot fill the prompt', () => {
    const turns = Array.from({ length: CONTEXT_TURN_LIMIT + 5 }, (_, index) =>
      at(index, `turn ${index}`, String(index)),
    );

    const window = contextWindow(
      turns,
      new Date(noon.getTime() + (CONTEXT_TURN_LIMIT + 5) * 60 * 1000),
    );

    expect(window).toHaveLength(CONTEXT_TURN_LIMIT);
    expect(window[0]?.sourceRef).toBe('5');
  });

  it('pulls a replied-to turn back in when the user jumps to an older message', () => {
    const turns = [at(0, 'the address was X', '1'), at(40, 'unrelated', '2')];

    expect(
      contextWindow(turns, new Date(noon.getTime() + 41 * 60 * 1000), '1').map(
        (turn) => turn.sourceRef,
      ),
    ).toEqual(['1', '2']);
  });
});
