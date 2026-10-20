import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { Api } from 'grammy';
import { describe, expect, it } from 'vitest';
import { storedInputFile } from './attachments.ts';

describe('storedInputFile', () => {
  it('names the upload after the original file when one is given', () => {
    const body = Readable.from([Buffer.from('x')]);

    expect(storedInputFile(body, 'documents/2026/10/uuid.pdf', 'Программа.pdf').filename).toBe(
      'Программа.pdf',
    );

    expect(storedInputFile(body, 'documents/2026/10/uuid.pdf').filename).toBe('uuid.pdf');
  });

  it('keeps a sender name from ending the unquoted multipart filename', async () => {
    let received = '';

    const server = createServer((request, response) => {
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => (received += chunk));

      request.on('end', () => {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ ok: true, result: { message_id: 1 } }));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      const { port } = server.address() as AddressInfo;
      const api = new Api('1:x', { apiRoot: `http://127.0.0.1:${port}` });
      const body = Readable.from([Buffer.from('x')]);

      await api.sendDocument(
        7,
        storedInputFile(body, 'documents/2026/10/uuid.pdf', 'Акт; "v2"\\.pdf'),
      );

      expect(received).toContain('filename=Акт_ _v2__.pdf\r\n');
    } finally {
      server.close();
    }
  });

  it('uploads a stream that carries a url key, as an S3 body does', async () => {
    let received = '';

    const server = createServer((request, response) => {
      request.setEncoding('latin1');
      request.on('data', (chunk: string) => (received += chunk));

      request.on('end', () => {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ ok: true, result: { message_id: 1 } }));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      const { port } = server.address() as AddressInfo;
      const api = new Api('1:x', { apiRoot: `http://127.0.0.1:${port}` });
      const body = Object.assign(Readable.from([Buffer.from('%PDF-1.7 body')]), { url: '' });

      await api.sendDocument(7, storedInputFile(body, 'documents/2026/10/card.pdf'));

      expect(received).toContain('filename=card.pdf');
      expect(received).toContain('%PDF-1.7 body');
    } finally {
      server.close();
    }
  });
});
