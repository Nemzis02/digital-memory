import type { UUID } from 'node:crypto';
import { logger } from '../logging/logger.ts';
import { memoryId } from '../memory/id.ts';
import type { MemorySource } from '../memory/payload.ts';
import type { PipelineDeps } from './deps.ts';

const log = logger.child({ module: 'pipeline/undo' });

const MAX_CHILDREN = 512;

export interface UndoTarget {
  source: MemorySource;
  sourceRef: string;
}

export async function undoIngest(
  deps: Pick<PipelineDeps, 'store' | 'storage'>,
  target: UndoTarget,
): Promise<boolean> {
  const parentId = memoryId(target.source, target.sourceRef);
  const [parent] = await deps.store.fetch([parentId]);

  if (parent === undefined) {
    return false;
  }

  const children = await deps.store.list({ filter: { parentId }, limit: MAX_CHILDREN });
  const ids: UUID[] = [parentId, ...children.map((child) => child.id)];

  await deps.store.remove(ids);

  const key = parent.r2_file_path;

  if (key !== undefined) {
    await deps.storage.remove(key);
  }

  log.info('undone', { id: parentId, points: ids.length });

  return true;
}
