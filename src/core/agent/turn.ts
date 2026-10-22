import type { ConversationTurn } from '../conversation/context.ts';
import type { InboundMessage } from '../ingestion/inbound.ts';
import { turnBody } from '../ingestion/inbound.ts';
import {
  escapeHtml,
  formatAnswer,
  present,
  savedReply,
  type RouteReply,
} from '../ingestion/reply.ts';
import type { ChatModel, ChatTurn, ToolCall, ToolSpecs } from '../llm/router.ts';
import { StepLimitError } from '../llm/router.ts';
import { logger } from '../logging/logger.ts';
import { cite, usedParents } from '../retrieval/query.ts';
import { systemPrompt } from './prompt.ts';
import { createAgentTools, type AgentToolDeps, type AgentTurn } from './tools.ts';

const log = logger.child({ module: 'agent/turn' });

export const MAX_STEPS = 4;
export const TURN_TIMEOUT_MS = 30_000;
export const TIMEOUT_REPLY = 'That took too long. Try again or ask a shorter question.';

// Telegram rejects an empty message, and a reply of only `Sources:` still has files to show.
const SOURCED_ONLY = 'See the memories below.';

export interface TurnDeps extends AgentToolDeps {
  model: ChatModel;
  now?: () => Date;
}

export interface TurnOptions {
  /** False on the re-run after Undo, so the model cannot save the same message again. */
  saving?: boolean;
}

function userText(message: InboundMessage): string {
  // Captionless files never reach a turn, so without this the model would not know one is attached.
  return message.file === undefined ? turnBody(message) : `[${message.type}] ${turnBody(message)}`;
}

function toTurns(context: readonly ConversationTurn[], message: InboundMessage): ChatTurn[] {
  const prior: ChatTurn[] = context.map((turn) => ({
    role: turn.role === 'assistant' ? 'model' : 'user',
    parts: [{ type: 'text', text: turn.body }],
  }));

  return [...prior, { role: 'user', parts: [{ type: 'text', text: userText(message) }] }];
}

function answered(turn: AgentTurn, text: string) {
  const sourced = usedParents(text, [...turn.shown.values()]);
  const answer = sourced.answer === '' ? SOURCED_ONLY : sourced.answer;

  return formatAnswer({ answer, citations: cite(sourced.parents) });
}

function compose(turn: AgentTurn, text: string, calls: readonly ToolCall[]): RouteReply {
  const { saved, forgetCandidate } = turn.effects;

  // One keyboard per reply: a save in the same turn loses its Undo to the Forget button.
  if (forgetCandidate !== undefined) {
    return {
      text: `Forget ${forgetCandidate.summary}?`,
      keyboard: 'forget',
      parentId: forgetCandidate.id,
    };
  }

  if (saved === undefined) {
    return { ...answered(turn, text), keyboard: 'none' };
  }

  const confirmation = savedReply(saved);

  if (calls.every((call) => call.name === 'save_memory')) {
    return { text: confirmation, keyboard: 'undo' };
  }

  const answer = answered(turn, text);

  return {
    text: `${confirmation}\n\n${answer.text}`,
    // The confirmation is not markdown: a summary with `*` or `_` must stay literal.
    html: `${escapeHtml(confirmation)}\n\n${answer.html}`,
    ...(answer.files === undefined ? {} : { files: answer.files }),
    keyboard: 'undo',
  };
}

async function timedOut(turn: AgentTurn): Promise<RouteReply> {
  // Ingestion is not cancelled, so a save still in flight will land; wait for it to offer Undo.
  const saved = await turn.effects.pending?.catch((error: unknown) => {
    log.warn('save failed after the turn timed out', { error });

    return undefined;
  });

  if (saved !== undefined) {
    log.warn('turn timed out after a save', { id: saved.id });

    return present({ text: savedReply(saved), keyboard: 'undo' });
  }

  log.warn('turn timed out', { ms: TURN_TIMEOUT_MS });

  return present({ text: TIMEOUT_REPLY, keyboard: 'none' });
}

/** One tool-calling model turn for a text message, composed into the reply the bot renders. */
export async function runTurn(
  deps: TurnDeps,
  message: InboundMessage,
  context: readonly ConversationTurn[],
  options?: TurnOptions,
): Promise<RouteReply> {
  const saving = options?.saving ?? true;
  const now = deps.now ?? (() => new Date());
  const turn: AgentTurn = { message, effects: {}, shown: new Map() };
  const { save_memory: save, ...rest } = createAgentTools(deps, turn);
  const tools: ToolSpecs = saving ? { ...rest, save_memory: save } : rest;

  const request = {
    system: systemPrompt({ today: now().toISOString().slice(0, 10), saving }),
    turns: toTurns(context, message),
  };

  // Not `AbortSignal.timeout()`: its timer is internal to Node, so a test cannot fake it.
  const budget = new AbortController();

  const timer = setTimeout(() => {
    budget.abort(new DOMException('The turn ran out of time', 'TimeoutError'));
  }, TURN_TIMEOUT_MS);

  try {
    const { text, calls } = await deps.model.run(request, tools, MAX_STEPS, budget.signal);

    log.info('turn', {
      calls: calls.map((call) => call.name),
      saved: turn.effects.saved?.id,
      forget: turn.effects.forgetCandidate?.id,
    });

    return present(compose(turn, text, calls));
  } catch (error) {
    if (budget.signal.aborted) {
      return timedOut(turn);
    }

    const saved = turn.effects.saved;

    // The capped step's tools have already run, so a save may have landed; it keeps its Undo.
    if (error instanceof StepLimitError && saved !== undefined) {
      log.warn('step limit reached after a save', { id: saved.id, calls: error.calls.length });

      return present({ text: savedReply(saved), keyboard: 'undo' });
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}
