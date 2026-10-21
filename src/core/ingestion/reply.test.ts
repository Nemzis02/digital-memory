import { describe, expect, it } from 'vitest';
import { formatAnswer, present, savedReply } from './reply.ts';

const PARENT = '6b1e8a2c-9d4f-4c7a-8e1b-3a5d7c9e0f12';
const OTHER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const KEY = 'documents/2026/10/11111111-1111-4111-8111-111111111111.txt';

describe('formatAnswer', () => {
  it('attaches cited files and links cited pages, keeping keys out of the text', () => {
    const reply = formatAnswer({
      answer: 'Tuesday at 10.',
      citations: [
        {
          id: PARENT,
          summary: 'Appointment card',
          file: { key: 'photos/2026/03/dentist.jpg', type: 'photo' },
        },
        { id: OTHER, summary: 'Paella page', url: 'https://example.com/paella' },
      ],
    });

    expect(reply).toStrictEqual({
      text: 'Tuesday at 10.\n\nPaella page',
      html: 'Tuesday at 10.\n\n<a href="https://example.com/paella">Paella page</a>',
      files: [{ key: 'photos/2026/03/dentist.jpg', type: 'photo', summary: 'Appointment card' }],
    });
  });

  it('renders markdown as telegram html and keeps the text as markdown', () => {
    const reply = formatAnswer({ answer: '**Tuesday** at 10.\n\n- card', citations: [] });

    expect(reply.text).toBe('**Tuesday** at 10.\n\n- card');
    expect(reply.html).toBe('<b>Tuesday</b> at 10.\n\n• card');
  });

  it('escapes the answer and the summary inside the link', () => {
    const reply = formatAnswer({
      answer: 'a < b & c',
      citations: [
        {
          id: PARENT,
          summary: 'card</a><a href="https://evil.example">',
          url: 'https://signed.example/a.jpg?q="1"',
        },
      ],
    });

    expect(reply.text).toBe('a < b & c\n\ncard</a><a href="https://evil.example">');
    expect(reply.text).not.toContain('signed.example');

    expect(reply.html).toBe(
      [
        'a &lt; b &amp; c',
        '',
        '<a href="https://signed.example/a.jpg?q=&quot;1&quot;">card&lt;/a&gt;&lt;a href="https://evil.example"&gt;</a>',
      ].join('\n'),
    );
  });
});

describe('present', () => {
  it('clips the text at the telegram limit and leaves the html for the bot to split', () => {
    const reply = present({
      text: 'a'.repeat(5000),
      html: 'a'.repeat(5000),
      keyboard: 'none',
    });

    expect(reply.text).toHaveLength(4096);
    expect(reply.html).toHaveLength(5000);
  });

  it('returns a reply within the limit unchanged', () => {
    const reply = { text: 'short', keyboard: 'none' } as const;

    expect(present(reply)).toBe(reply);
  });
});

describe('savedReply', () => {
  it('leads with the kind and category, then the summary and the tags', () => {
    const text = savedReply({
      id: '22222222-2222-4222-8222-222222222222',
      summary: 'Tapas at Bar Pepe.',
      category: 'food',
      kind: 'recommendation',
      tags: ['#tapas', '#valencia'],
      key: KEY,
      points: 2,
    });

    expect(text).toBe('Saved recommendation · food\nTapas at Bar Pepe.\n#tapas #valencia');
  });

  it('omits the tag line when nothing was tagged', () => {
    const text = savedReply({
      id: '22222222-2222-4222-8222-222222222222',
      summary: 'A note.',
      category: 'other',
      kind: 'note',
      tags: [],
      key: KEY,
      points: 2,
    });

    expect(text).toBe('Saved note · other\nA note.');
  });
});
