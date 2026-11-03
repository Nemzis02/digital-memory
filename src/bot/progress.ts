import type { Api } from 'grammy';
import type { Chat } from 'grammy/types';
import { logger } from '../core/logging/logger.ts';
import type { Progress, Stage } from '../core/progress.ts';

const log = logger.child({ module: 'bot/progress' });

const DRAFT_TEXT: Record<Stage, string> = {
  thinking: 'Thinking',
  reading: 'Reading the file',
  searching: 'Searching memory',
  saving: 'Saving',
};

export const MIN_INTERVAL_MS = 1000;

export const HEARTBEAT_MS = 10_000;

export const TYPING_MS = 4000;

export interface ProgressDisplay {
  readonly report: Progress;
  stop(): Promise<void>;
}

type Mode = 'draft' | 'typing';

type ApiSignal = NonNullable<Parameters<Api['sendChatAction']>[3]>;

export function progressDisplay(api: Api, chat: Chat, draftId: number): ProgressDisplay {
  const controller = new AbortController();
  const signal = controller.signal as unknown as ApiSignal;
  let mode: Mode = chat.type === 'private' ? 'draft' : 'typing';
  let current: Stage | undefined;
  let shown: Stage | undefined;
  let sentAt: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  let stopped = false;

  function send(stage: Stage): Promise<true> {
    return mode === 'draft'
      ? api.sendMessageDraft(chat.id, draftId, DRAFT_TEXT[stage], undefined, signal)
      : api.sendChatAction(chat.id, 'typing', undefined, signal);
  }

  function failed(error: unknown): void {
    if (stopped) {
      log.debug('progress send ended by stop', { error });
      return;
    }

    if (mode === 'draft') {
      log.warn('drafts are unavailable here, showing typing instead', { error });
      mode = 'typing';
      shown = undefined;
      sentAt = undefined;
      return;
    }

    log.warn('typing status failed, no progress for this turn', { error });
    stopped = true;
  }

  function delay(): number {
    if (sentAt === undefined) {
      return 0;
    }

    const elapsed = Date.now() - sentAt;

    if (mode === 'typing') {
      return Math.max(0, TYPING_MS - elapsed);
    }

    const due = current === shown ? HEARTBEAT_MS : MIN_INTERVAL_MS;

    return Math.max(0, due - elapsed);
  }

  function flush(): void {
    timer = undefined;

    const stage = current;

    if (stopped || inFlight !== undefined || stage === undefined) {
      return;
    }

    sentAt = Date.now();
    shown = stage;

    inFlight = send(stage)
      .then(
        () => undefined,
        (error: unknown) => {
          failed(error);
        },
      )
      .finally(() => {
        inFlight = undefined;

        if (!stopped) {
          timer = setTimeout(flush, delay());
          timer.unref();
        }
      });
  }

  return {
    report(stage) {
      if (stopped || stage === current) {
        return;
      }

      current = stage;

      if (inFlight !== undefined) {
        return;
      }

      if (timer !== undefined) {
        clearTimeout(timer);
      }

      const wait = delay();

      if (wait === 0) {
        flush();
        return;
      }

      timer = setTimeout(flush, wait);
      timer.unref();
    },

    async stop() {
      stopped = true;

      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }

      controller.abort();

      await inFlight;
    },
  };
}
