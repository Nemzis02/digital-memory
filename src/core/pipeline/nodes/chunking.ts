import { logger } from '../../logging/logger.ts';
import { chunkId } from '../../memory/id.ts';
import { parseMemoryPayload, type MemoryPayload } from '../../memory/payload.ts';
import { splitText } from '../chunk.ts';
import { requireEnrichment, requireStored } from '../state.ts';
import type { IngestionStateType, IngestionUpdate } from '../state.ts';

const log = logger.child({ module: 'pipeline/chunking' });

export function chunkPayloads(parent: MemoryPayload): MemoryPayload[] {
  const texts = splitText(parent.original_text);

  const children = (texts.length === 0 ? [parent.original_text] : texts).map((text, index) =>
    parseMemoryPayload({
      ...parent,
      id: chunkId(parent.id, index),
      original_text: text,
      chunking: { is_child: true, parent_id: parent.id },
    }),
  );

  return [parent, ...children];
}

export function createChunkingNode() {
  return (state: IngestionStateType): IngestionUpdate => {
    const { id, source, message, createdAt, originalText } = state;
    const enrichment = requireEnrichment(state);
    const stored = requireStored(state);

    const shared = {
      source,
      source_ref: message.sourceRef,
      type: message.type,
      summary: enrichment.summary,
      ...(message.sourceUrl === undefined ? {} : { source_url: message.sourceUrl }),
      r2_file_path: stored.key,
      ...(stored.fileName === undefined ? {} : { file_name: stored.fileName }),
      metadata: {
        category: enrichment.category,
        kind: enrichment.kind,
        ...(enrichment.location === undefined ? {} : { location: enrichment.location }),
        tags: enrichment.tags,
      },
      created_at: createdAt,
      ...(enrichment.eventAt === undefined ? {} : { event_at: enrichment.eventAt }),
    };

    const parent = parseMemoryPayload({
      ...shared,
      id,
      original_text: originalText,
      chunking: { is_child: false },
    });

    const payloads = chunkPayloads(parent);

    log.debug('chunked', { children: payloads.length - 1, chars: originalText.length });

    return { payloads };
  };
}
