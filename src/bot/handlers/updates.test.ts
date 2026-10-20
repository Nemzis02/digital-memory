import type { Message, User } from 'grammy/types';
import { describe, expect, it } from 'vitest';
import { inboundFromMessage } from './updates.ts';

const from: User = { id: 42, is_bot: false, first_name: 'Kyerin' };

function message(overrides: Partial<Message>): Message {
  return {
    message_id: 10,
    date: 1_700_000_000,
    chat: { id: 7, type: 'private' },
    ...overrides,
  } as Message;
}

describe('inboundFromMessage', () => {
  it('maps a note, a lone URL, and a URL buried in a sentence', () => {
    expect(inboundFromMessage(message({ text: 'buy milk' }), from)).toMatchObject({
      type: 'text',
      text: 'buy milk',
      userRef: '42',
      chatRef: '7',
      sourceRef: '10',
    });

    expect(inboundFromMessage(message({ text: '  https://example.com/a  ' }), from)).toMatchObject({
      type: 'url',
      sourceUrl: 'https://example.com/a',
    });

    expect(inboundFromMessage(message({ text: 'see https://example.com/a' }), from)).toMatchObject({
      type: 'text',
    });
  });

  it('keeps the largest photo and carries a reply target', () => {
    const inbound = inboundFromMessage(
      message({
        caption: 'menu',
        photo: [
          { file_id: 'small', file_unique_id: 's', width: 1, height: 1 },
          { file_id: 'big', file_unique_id: 'b', width: 10, height: 10 },
        ],
        reply_to_message: message({ message_id: 3, text: 'earlier' }) as never,
      }),
      from,
    );

    expect(inbound).toMatchObject({
      type: 'photo',
      text: 'menu',
      file: { fileId: 'big' },
      replyToSourceRef: '3',
    });
  });

  it('maps a document and a voice note, and ignores a sticker', () => {
    expect(
      inboundFromMessage(
        message({
          document: {
            file_id: 'doc',
            file_unique_id: 'd',
            file_name: 'a.pdf',
            mime_type: 'application/pdf',
          },
        }),
        from,
      ),
    ).toMatchObject({
      type: 'document',
      file: { fileId: 'doc', fileName: 'a.pdf', mimeType: 'application/pdf' },
    });

    expect(
      inboundFromMessage(
        message({
          voice: { file_id: 'voc', file_unique_id: 'v', duration: 2, mime_type: 'audio/ogg' },
        }),
        from,
      ),
    ).toMatchObject({ type: 'voice', file: { fileId: 'voc', mimeType: 'audio/ogg' } });

    expect(
      inboundFromMessage(
        message({
          sticker: {
            file_id: 's',
            file_unique_id: 'u',
            type: 'regular',
            width: 1,
            height: 1,
            is_animated: false,
            is_video: false,
          },
        }),
        from,
      ),
    ).toBeUndefined();
  });
});
