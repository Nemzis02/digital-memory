import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../../config/env.ts';
import { getEnv, r2Endpoint } from '../../config/env.ts';
import { logger } from '../logging/logger.ts';
import { isObjectKey, objectKey, resolveContent } from './content.ts';
import type { ObjectStorage } from './object-storage.ts';
import { ObjectNotFoundError } from './object-storage.ts';

const log = logger.child({ module: 'storage/r2' });

export function createR2Storage(env: Env = getEnv()): ObjectStorage {
  const bucket = env.R2_BUCKET_NAME;
  const maxTtl = env.R2_PRESIGN_TTL_SECONDS;

  const client = new S3Client({
    region: 'auto',
    endpoint: r2Endpoint(env),
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    requestHandler: { connectionTimeout: 3_000, requestTimeout: 30_000 },
  });

  return {
    async upload(input) {
      const { contentType, extension } = await resolveContent(
        input.body,
        input.contentType,
        input.fileName,
      );

      if (input.key !== undefined && !isObjectKey(input.key)) {
        throw new TypeError(`Refusing to upload to an unrecognised key: ${input.key}`);
      }

      const key = input.key ?? objectKey(input.kind, extension);

      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: input.body,
          ContentType: contentType,
          ContentDisposition: 'attachment',
        }),
      );

      log.debug('object stored', { key, contentType, size: input.body.byteLength });

      return {
        key,
        size: input.body.byteLength,
        contentType,
      };
    },

    async presignDownload(key, expiresIn = maxTtl) {
      if (!Number.isFinite(expiresIn)) {
        throw new TypeError(`expiresIn must be a finite number of seconds: ${String(expiresIn)}`);
      }

      const ttl = Math.min(Math.max(Math.floor(expiresIn), 1), maxTtl);

      log.debug('issuing pre-signed download', { key, ttl });

      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: ttl,
      });
    },

    async openStream(key) {
      try {
        const { Body } = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));

        if (Body === undefined) {
          throw new ObjectNotFoundError(key);
        }

        return Body as Readable;
      } catch (error) {
        if (error instanceof NoSuchKey) {
          throw new ObjectNotFoundError(key, { cause: error });
        }

        throw error;
      }
    },

    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));

      log.debug('object removed', { key });
    },
  };
}

let shared: ObjectStorage | undefined;

export function r2Storage(): ObjectStorage {
  shared ??= createR2Storage();

  return shared;
}

export function resetR2Storage(): void {
  shared = undefined;
}
