import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel, ModelMessage } from 'ai';
import { generateText, Output } from 'ai';
import type { ZodType } from 'zod';
import type { Env } from '../../config/env.ts';
import { getEnv } from '../../config/env.ts';
import { logger } from '../logging/logger.ts';

const log = logger.child({ module: 'llm/router' });

export const FAST_MODEL = 'gemini-3.8-flash';
export const STRONG_MODEL = 'claude-sonnet-5-5';

const STRONG_MAX_TOKENS = 8192;

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;

// Telegram voice notes arrive as audio/ogg; the rest are what a forwarded document can be.
const FAST_MEDIA = [
  ...IMAGE_TYPES,
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/flac',
  'audio/aac',
  'application/pdf',
  'text/plain',
] as const;

const STRONG_MEDIA = [...IMAGE_TYPES, 'application/pdf'] as const;

export type ModelRole = 'fast' | 'strong';

export type ChatPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'file'; readonly mimeType: string; readonly data: Uint8Array };

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
  object<T>(request: CompletionRequest, schema: ZodType<T>): Promise<T>;
}

export interface LlmRouter {
  model(role: ModelRole): ChatModel;
}

interface ModelSpec {
  id: string;
  model: LanguageModel;
  media: readonly string[];
  reasoning?: 'low';
  maxOutputTokens?: number;
}

function mediaType(spec: ModelSpec, mimeType: string): string {
  const base = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';

  if (!spec.media.includes(base)) {
    throw new TypeError(`${spec.id} cannot read ${mimeType}`);
  }

  return base;
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

function toMessage(spec: ModelSpec, turn: ChatTurn): ModelMessage {
  const content = turn.parts.map((part) =>
    part.type === 'text'
      ? { type: 'text' as const, text: part.text }
      : { type: 'file' as const, mediaType: mediaType(spec, part.mimeType), data: part.data },
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
  function call(request: CompletionRequest) {
    const { system, turns } = prepared(request);

    return {
      model: spec.model,
      instructions: system,
      messages: turns.map((turn) => toMessage(spec, turn)),
      ...(spec.reasoning === undefined ? {} : { reasoning: spec.reasoning }),
      ...(spec.maxOutputTokens === undefined ? {} : { maxOutputTokens: spec.maxOutputTokens }),
    };
  }

  return {
    id: spec.id,
    async complete(request) {
      const { text } = await generateText(call(request));

      const answer = requireText(text, spec.id);

      log.debug('completion', { model: spec.id });

      return answer;
    },
    async object(request, schema) {
      const { output } = await generateText({
        ...call(request),
        output: Output.object({ schema }),
      });

      log.debug('object', { model: spec.id });

      return output;
    },
  };
}

export function createRouter(env: Env = getEnv()): LlmRouter {
  const google = createGoogleGenerativeAI({ apiKey: env.LLM_FAST_API_KEY });

  const fast = chatModel({
    id: FAST_MODEL,
    model: google(FAST_MODEL),
    media: FAST_MEDIA,
    reasoning: 'low',
  });

  let strong: ChatModel | undefined;

  return {
    model(role) {
      if (role === 'fast') {
        return fast;
      }

      const apiKey = env.LLM_STRONG_API_KEY;

      if (apiKey === undefined) {
        throw new Error('LLM_STRONG_API_KEY is required for the strong model');
      }

      strong ??= chatModel({
        id: STRONG_MODEL,
        model: createAnthropic({ apiKey })(STRONG_MODEL),
        media: STRONG_MEDIA,
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
