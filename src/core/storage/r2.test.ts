import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { parseEnv } from '../../config/env.ts';
import { ObjectNotFoundError } from './object-storage.ts';
import { createR2Storage } from './r2.ts';

const { sendMock, clientConfigs } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  clientConfigs: [] as Record<string, unknown>[],
}));

vi.mock('@aws-sdk/client-s3', () => {
  class Command {
    input: Record<string, unknown>;

    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }

  class S3Client {
    send = sendMock;

    constructor(config: Record<string, unknown>) {
      clientConfigs.push(config);
    }
  }

  return {
    S3Client,
    NoSuchKey: class extends Error {},
    PutObjectCommand: class extends Command {},
    GetObjectCommand: class extends Command {},
    DeleteObjectCommand: class extends Command {},
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(() => Promise.resolve('https://signed.example/object?X-Amz-Signature=abc')),
}));

const env = parseEnv({
  TELEGRAM_BOT_TOKEN: '123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', // gitleaks:allow
  TELEGRAM_ADMIN_ID: '123456789',
  DATABASE_URL: 'postgresql://digital_memory:pw@localhost:5432/digital_memory',
  QDRANT_URL: 'https://example.cloud.qdrant.io:6333',
  QDRANT_API_KEY: 'qdrant-key',
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'access',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET_NAME: 'digital-memory',
  LLM_FAST_API_KEY: 'llm-key',
});

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);

const commandInput = (call: number): Record<string, unknown> =>
  (sendMock.mock.calls[call]?.[0] as { input: Record<string, unknown> }).input;

describe('createR2Storage', () => {
  beforeEach(() => {
    sendMock.mockReset().mockResolvedValue({});
    clientConfigs.length = 0;
    vi.mocked(getSignedUrl).mockClear();
    vi.useFakeTimers().setSystemTime(new Date('2026-03-09T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('points the S3 client at the account endpoint with a region placeholder', () => {
    createR2Storage(env);

    expect(clientConfigs[0]).toMatchObject({
      region: 'auto',
      endpoint: 'https://acct.r2.cloudflarestorage.com',
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  });

  it('stores the sniffed type, forces a download, and reports what it wrote', async () => {
    const stored = await createR2Storage(env).upload({
      kind: 'photo',
      body: JPEG,
      contentType: 'text/html',
      fileName: 'selfie.html',
    });

    expect(stored).toStrictEqual({ key: stored.key, size: 4, contentType: 'image/jpeg' });
    expect(stored.key).toMatch(/^photos\/2026\/03\/[0-9a-f-]{36}\.jpg$/);
    expect(sendMock.mock.calls[0]?.[0]).toBeInstanceOf(PutObjectCommand);

    expect(commandInput(0)).toStrictEqual({
      Bucket: 'digital-memory',
      Key: stored.key,
      Body: JPEG,
      ContentType: 'image/jpeg',
      ContentDisposition: 'attachment',
    });
  });

  it('keeps a caller-supplied key so a retried upload does not orphan an object', async () => {
    const storage = createR2Storage(env);
    const first = await storage.upload({ kind: 'document', body: JPEG });

    await storage.upload({ kind: 'document', body: JPEG, key: first.key });

    expect(commandInput(1).Key).toBe(first.key);
  });

  it('refuses a key it did not mint, so a retry cannot be steered elsewhere', async () => {
    const storage = createR2Storage(env);

    await expect(
      storage.upload({ kind: 'document', body: JPEG, key: '../../etc/passwd' }),
    ).rejects.toThrow(TypeError);

    expect(sendMock).not.toHaveBeenCalled();
  });

  it('rejects a non-finite TTL instead of signing a URL R2 will refuse', async () => {
    await expect(createR2Storage(env).presignDownload('photos/a.jpg', Number.NaN)).rejects.toThrow(
      TypeError,
    );

    expect(vi.mocked(getSignedUrl)).not.toHaveBeenCalled();
  });

  it('clamps the pre-signed TTL to the configured ceiling', async () => {
    await createR2Storage(env).presignDownload('photos/a.jpg', 3600);

    expect(vi.mocked(getSignedUrl).mock.calls[0]?.[2]).toEqual({ expiresIn: 900 });
  });

  it('honours a shorter requested TTL and signs a GET', async () => {
    const url = await createR2Storage(env).presignDownload('photos/a.jpg', 60);

    expect(vi.mocked(getSignedUrl).mock.calls[0]?.[1]).toBeInstanceOf(GetObjectCommand);
    expect(vi.mocked(getSignedUrl).mock.calls[0]?.[2]).toEqual({ expiresIn: 60 });
    expect(url).not.toMatch(/r2\.dev/);
  });

  it('streams an object body', async () => {
    sendMock.mockResolvedValueOnce({ Body: 'stream' });

    await expect(createR2Storage(env).openStream('photos/a.jpg')).resolves.toBe('stream');
  });

  it('translates a missing object into a vendor-neutral error', async () => {
    const storage = createR2Storage(env);

    sendMock.mockRejectedValueOnce(new NoSuchKey({ message: 'nope' } as never));
    await expect(storage.openStream('photos/a.jpg')).rejects.toThrow(ObjectNotFoundError);

    sendMock.mockRejectedValueOnce(new Error('connection reset'));
    await expect(storage.openStream('photos/a.jpg')).rejects.toThrow(/connection reset/);
  });

  it('deletes by key', async () => {
    await createR2Storage(env).remove('voice/2026/03/x.oga');

    expect(sendMock.mock.calls[0]?.[0]).toBeInstanceOf(DeleteObjectCommand);
    expect(commandInput(0)).toEqual({ Bucket: 'digital-memory', Key: 'voice/2026/03/x.oga' });
  });
});
