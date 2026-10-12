import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel, ModelMessage } from 'ai';
import { generateText } from 'ai';
import type { Env } from '../../config/env.ts';
import { getEnv } from '../../config/env.ts';
import { logger } from '../logging/logger.ts';

const log = logger.child({ module: 'llm/router' });

export const FAST_MODEL = 'gemini-3.8-flash';
export const STRONG_MODEL = 'claude-sonnet-5-5';

const STRONG_MAX_TOKENS = 8192;

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;

type ImageType = (typeof IMAGE_TYPES)[number];

export type ModelRole = 'fast' | 'strong';

export type ChatPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly mimeType: string; readonly data: Uint8Array };

export interface ChatTurn {
  role: 'user' | 'model';
  parts: readonly ChatPart[];
}

export interface CompletionRequest {
  system: string;
  turns: readonly ChatTurn[];
}

export interface ChatModel {
  readonly id: string;
  complete(request: CompletionRequest): Promise<string>;
}

export interface LlmRouter {
  model(role: ModelRole): ChatModel;
}

interface ModelSpec {
  id: string;
  model: LanguageModel;
  reasoning?: 'low';
  maxOutputTokens?: number;
}

function imageType(mimeType: string): ImageType {
  const match = IMAGE_TYPES.find((type) => type === mimeType);

  if (match === undefined) {
    throw new TypeError(`Unsupported image type ${mimeType}`);
  }

  return match;
}

function prepared(request: CompletionRequest): CompletionRequest {
  const last = request.turns.at(-1);

  if (request.system.trim().length === 0 || last === undefined || last.role !== 'user') {
    throw new TypeError('A completion needs a system instruction and must end on a user turn');
  }

  if (request.turns.some((turn) => turn.parts.length === 0)) {
    throw new TypeError('A turn needs at least one part');
  }

  if (!last.parts.some((part) => part.type === 'text' && part.text.trim().length > 0)) {
    throw new TypeError('The final user turn needs non-empty text');
  }

  return request;
}

function toMessage(turn: ChatTurn): ModelMessage {
  const content = turn.parts.map((part) =>
    part.type === 'text'
      ? { type: 'text' as const, text: part.text }
      : { type: 'file' as const, mediaType: imageType(part.mimeType), data: part.data },
  );

  if (turn.role === 'model') {
    return { role: 'assistant', content };
  }

  return { role: 'user', content };
}

function requireText(text: string, model: string): string {
  if (text.length === 0) {
    throw new Error(`${model} returned no text`);
  }

  return text;
}

function chatModel(spec: ModelSpec): ChatModel {
  return {
    id: spec.id,
    async complete(request) {
      const { system, turns } = prepared(request);

      const { text } = await generateText({
        model: spec.model,
        instructions: system,
        messages: turns.map(toMessage),
        ...(spec.reasoning === undefined ? {} : { reasoning: spec.reasoning }),
        ...(spec.maxOutputTokens === undefined ? {} : { maxOutputTokens: spec.maxOutputTokens }),
      });

      const answer = requireText(text, spec.id);

      log.debug('completion', { model: spec.id });

      return answer;
    },
  };
}

export function createRouter(env: Env = getEnv()): LlmRouter {
  const google = createGoogleGenerativeAI({ apiKey: env.LLM_API_KEY });

  const fast = chatModel({
    id: FAST_MODEL,
    model: google(FAST_MODEL),
    reasoning: 'low',
  });

  let strong: ChatModel | undefined;

  return {
    model(role) {
      if (role === 'fast') {
        return fast;
      }

      const apiKey = env.ANTHROPIC_API_KEY;

      if (apiKey === undefined) {
        throw new Error('ANTHROPIC_API_KEY is required for the strong model');
      }

      strong ??= chatModel({
        id: STRONG_MODEL,
        model: createAnthropic({ apiKey })(STRONG_MODEL),
        maxOutputTokens: STRONG_MAX_TOKENS,
      });

      return strong;
    },
  };
}

let shared: LlmRouter | undefined;

export function llmRouter(): LlmRouter {
  shared ??= createRouter();

  return shared;
}

export function resetLlmRouter(): void {
  shared = undefined;
}
