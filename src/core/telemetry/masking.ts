import type { Attributes, AttributeValue } from '@opentelemetry/api';
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { maskSecrets } from '../logging/redact.ts';

function maskValue(value: AttributeValue | undefined): AttributeValue | undefined {
  if (typeof value === 'string') {
    return maskSecrets(value);
  }

  if (Array.isArray(value)) {
    return value.map((item: unknown) => (typeof item === 'string' ? maskSecrets(item) : item)) as
      AttributeValue | undefined;
  }

  return value;
}

function maskAttributes(attributes: Attributes): void {
  for (const [key, value] of Object.entries(attributes)) {
    attributes[key] = maskValue(value);
  }
}

export function maskSpan(span: ReadableSpan): void {
  maskAttributes(span.attributes);

  for (const event of span.events) {
    if (event.attributes !== undefined) {
      maskAttributes(event.attributes);
    }
  }

  if (span.status.message !== undefined) {
    span.status.message = maskSecrets(span.status.message);
  }
}

export class MaskingSpanProcessor implements SpanProcessor {
  onStart(): void {}

  onEnding(span: Span): void {
    maskSpan(span);
  }

  onEnd(): void {}

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
