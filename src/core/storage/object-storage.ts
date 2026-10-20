import type { Readable } from 'node:stream';

export const OBJECT_KINDS = ['photo', 'document', 'voice'] as const;

export type ObjectKind = (typeof OBJECT_KINDS)[number];

export interface UploadInput {
  kind: ObjectKind;
  body: Uint8Array;
  contentType?: string;
  fileName?: string;
  key?: string;
}

export interface StoredObject {
  key: string;
  size: number;
  contentType: string;
}

export interface OpenedObject {
  body: Readable;
  size?: number;
}

export interface ObjectStorage {
  upload(input: UploadInput): Promise<StoredObject>;
  presignDownload(key: string, expiresIn?: number): Promise<string>;
  openStream(key: string): Promise<Readable>;
  openSized(key: string): Promise<OpenedObject>;
  remove(key: string): Promise<void>;
}

export class ObjectNotFoundError extends Error {
  constructor(key: string, options?: ErrorOptions) {
    super(`Object not found: ${key}`, options);
    this.name = 'ObjectNotFoundError';
  }
}
