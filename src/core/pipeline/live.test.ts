import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FileSource } from '../ingestion/file-source.ts';
import type { InboundMessage } from '../ingestion/inbound.ts';
import { embeddings } from '../llm/embeddings.ts';
import { llmRouter } from '../llm/router.ts';
import type { MemoryType } from '../memory/payload.ts';
import { r2Storage } from '../storage/r2.ts';
import { qdrantStore } from '../vector/qdrant.ts';
import { createIngestionPipeline } from './graph.ts';
import type { IngestResult } from './graph.ts';
import { createUrlFetcher } from './url.ts';

const KEYS = [
  'LLM_API_KEY',
  'QDRANT_API_KEY',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
] as const;

const live =
  process.env.INGEST_LIVE === '1' && KEYS.every((key) => (process.env[key]?.length ?? 0) > 0);

// Telegram re-encodes what it receives, so a locally synthesised file proves nothing about the
// bytes the bot will actually be handed. Point these at files saved out of a real chat.
function pathEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();

  return value === undefined || value === '' ? undefined : value;
}

const FIXTURES = {
  photo: pathEnv('INGEST_PHOTO'),
  voice: pathEnv('INGEST_VOICE'),
  document: pathEnv('INGEST_DOCUMENT'),
} as const;

const TIMEOUT = 120_000;

// Nothing else writes with this source yet, so `list({ sources: ['mcp'] })` finds whatever residue
// a crashed run left behind.
const SOURCE = 'mcp';

/** The fake treats a file id as a path, which is the whole of what the real source abstracts. */
const localFiles: FileSource = { download: (fileId) => readFile(fileId) };

function pipeline() {
  return createIngestionPipeline({
    files: localFiles,
    storage: r2Storage(),
    store: qdrantStore(),
    router: llmRouter(),
    embeddings: embeddings(),
    urls: createUrlFetcher(),
  });
}

function message(type: MemoryType, sourceRef: string, over: Partial<InboundMessage>) {
  return {
    sourceRef,
    chatRef: 'live',
    userRef: 'live',
    type,
    text: '',
    ...over,
  } satisfies InboundMessage;
}

function fileMessage(type: MemoryType, sourceRef: string, path: string, mimeType: string) {
  return message(type, sourceRef, {
    file: { fileId: path, fileName: basename(path), mimeType },
  });
}

const ingested: string[] = [];

async function ingest(input: InboundMessage): Promise<IngestResult> {
  const pipe = pipeline();

  await pipe.init();
  ingested.push(input.sourceRef);

  return pipe.ingest({ source: SOURCE, message: input });
}

/** Every assertion that does not depend on the medium, so each case only states its own part. */
async function expectIndexed(result: IngestResult, sourceRef: string): Promise<void> {
  const store = qdrantStore();

  expect(result.summary.length).toBeGreaterThan(0);
  expect(result.key.length).toBeGreaterThan(0);
  expect(result.points).toBeGreaterThanOrEqual(2);

  const [parent] = await store.fetch([result.id]);

  expect(parent?.source_ref).toBe(sourceRef);
  expect(parent?.r2_file_path).toBe(result.key);
  expect(parent?.chunking.is_child).toBe(false);

  const children = await store.list({ filter: { parentId: result.id } });

  expect(children.length).toBeGreaterThanOrEqual(1);
  expect(children.every((child) => child.chunking.parent_id === result.id)).toBe(true);

  const hits = await store.search({
    dense: await embeddings().embed(result.summary, 'query'),
    filter: { sourceRef, isChild: true },
    limit: 5,
  });

  expect(hits.length).toBeGreaterThanOrEqual(1);
}

afterEach(async () => {
  const refs = ingested.splice(0);

  if (!live) {
    return;
  }

  const pipe = pipeline();

  await Promise.all(refs.map((sourceRef) => pipe.undo({ source: SOURCE, sourceRef })));
}, TIMEOUT);

describe.skipIf(!live)('live ingestion', () => {
  it(
    'ingests a text note and then undoes it completely',
    async () => {
      const sourceRef = 'live-text';

      const result = await ingest(
        message('text', sourceRef, {
          text: 'Dentist appointment on 3 March at 09:30, Dr Varga, Károly körút 12, Budapest. Bring the referral.',
        }),
      );

      await expectIndexed(result, sourceRef);

      expect(result.tags.every((tag) => tag.startsWith('#'))).toBe(true);

      const store = qdrantStore();
      const pipe = pipeline();

      expect(await pipe.undo({ source: SOURCE, sourceRef })).toBe(true);
      expect(await store.fetch([result.id])).toHaveLength(0);
      expect(await store.list({ filter: { parentId: result.id } })).toHaveLength(0);
      expect(await pipe.undo({ source: SOURCE, sourceRef })).toBe(false);
    },
    TIMEOUT,
  );

  it(
    'fetches a link and keeps the article text next to the address',
    async () => {
      const sourceRef = 'live-url';
      const url = 'https://example.com';

      const result = await ingest(message('url', sourceRef, { text: url, sourceUrl: url }));

      await expectIndexed(result, sourceRef);

      const [parent] = await qdrantStore().fetch([result.id]);

      expect(parent?.source_url).toBe(url);
      expect(parent?.original_text).toContain('illustrative examples');
    },
    TIMEOUT,
  );

  it.skipIf(FIXTURES.photo === undefined)(
    'transcribes a photo',
    async () => {
      const sourceRef = 'live-photo';

      const result = await ingest(
        fileMessage('photo', sourceRef, FIXTURES.photo ?? '', 'image/jpeg'),
      );

      await expectIndexed(result, sourceRef);

      const [parent] = await qdrantStore().fetch([result.id]);

      expect(parent?.original_text.length).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it.skipIf(FIXTURES.voice === undefined)(
    'transcribes a voice note in the codec Telegram sends',
    async () => {
      const sourceRef = 'live-voice';

      const result = await ingest(
        fileMessage('voice', sourceRef, FIXTURES.voice ?? '', 'audio/ogg'),
      );

      await expectIndexed(result, sourceRef);

      const [parent] = await qdrantStore().fetch([result.id]);

      expect(parent?.original_text.length).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it.skipIf(FIXTURES.document === undefined)(
    'reads a document',
    async () => {
      const sourceRef = 'live-document';

      const result = await ingest(
        fileMessage('document', sourceRef, FIXTURES.document ?? '', 'application/pdf'),
      );

      await expectIndexed(result, sourceRef);

      const [parent] = await qdrantStore().fetch([result.id]);

      expect(parent?.original_text.length).toBeGreaterThan(0);
    },
    TIMEOUT,
  );
});
