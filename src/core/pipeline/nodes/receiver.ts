import { memoryId } from '../../memory/id.ts';
import { clock } from '../deps.ts';
import type { PipelineDeps } from '../deps.ts';
import type { IngestionStateType, IngestionUpdate } from '../state.ts';

export function createReceiverNode(deps: Pick<PipelineDeps, 'now'>) {
  return (state: IngestionStateType): IngestionUpdate => {
    const { source, message } = state;

    if (message.sourceRef.trim() === '') {
      throw new TypeError('An inbound message needs a source_ref to be addressable');
    }

    if (message.type === 'url' && message.sourceUrl === undefined) {
      throw new TypeError('A url message must carry its link');
    }

    return {
      id: memoryId(source, message.sourceRef),
      createdAt: Math.floor(clock(deps).getTime() / 1000),
    };
  };
}
