import { Bot } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serve } from '../app.ts';
import type { Running } from '../app.ts';

const TOKEN = '123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; // gitleaks:allow

const SECRET = 'b'.repeat(32);

const ME: UserFromGetMe = {
  id: 1,
  is_bot: true,
  first_name: 'memory',
  username: 'memory_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  supports_join_request_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
};

function botWith(record: { method: string; payload: unknown }[]): Bot {
  const bot = new Bot(TOKEN, { botInfo: ME });

  bot.api.config.use(async (_prev, method, payload) => {
    record.push({ method: String(method), payload });

    return { ok: true, result: true } as never;
  });

  return bot;
}

describe('listen', () => {
  const running: Running[] = [];

  afterEach(async () => {
    await Promise.all(running.splice(0).map((item) => item.close()));
  });

  it('polls when no public URL is set, after dropping a previously registered webhook', async () => {
    const calls: { method: string; payload: unknown }[] = [];
    const bot = botWith(calls);
    const start = vi.spyOn(bot, 'start').mockResolvedValue(undefined);

    const server = await serve(bot, { port: 0 });

    running.push(server);

    expect((await fetch(`http://127.0.0.1:${server.port}/`)).status).toBe(404);
    expect(calls.map((call) => call.method)).toEqual(['deleteWebhook']);

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ allowed_updates: ['message', 'callback_query'] }),
    );
  });

  it('checks the secret header before grammY sees a webhook request', async () => {
    const calls: { method: string; payload: unknown }[] = [];
    const bot = botWith(calls);
    const handled = vi.spyOn(bot, 'handleUpdate');

    const server = await serve(bot, {
      port: 0,
      publicUrl: 'https://example.com/app',
      webhookSecret: SECRET,
    });

    running.push(server);

    const webhook = calls.find((call) => call.method === 'setWebhook');

    expect(webhook?.payload).toMatchObject({
      url: 'https://example.com/app/telegram/webhook',
      secret_token: SECRET,
      allowed_updates: ['message', 'callback_query'],
    });

    const url = `http://127.0.0.1:${server.port}/telegram/webhook`;

    const forged = await fetch(url, {
      method: 'POST',
      body: '{"update_id":1,"message":{"from":{"id":1}}}',
    });

    expect(forged.status).toBe(401);
    expect(handled).not.toHaveBeenCalled();

    const accepted = await fetch(url, {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': SECRET },
      body: '{"update_id":1}',
    });

    expect(accepted.status).toBe(200);
    expect(handled).toHaveBeenCalledOnce();
  });

  it('refuses to listen on a webhook without the secret', async () => {
    const bot = new Bot(TOKEN, { botInfo: ME });

    await expect(serve(bot, { port: 0, publicUrl: 'https://example.com' })).rejects.toThrow(
      'TELEGRAM_WEBHOOK_SECRET',
    );
  });
});
