import { createHash } from 'node:crypto';

const TRANSPORT_KEYS = new Set([
  'idempotencyKey',
  'messageId',
  'correlationId',
  'causationId',
  'occurredAt',
]);

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical JSON does not support non-finite numbers');
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));

    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`)
      .join(',')}}`;
  }

  throw new TypeError(`Canonical JSON does not support ${typeof value}`);
}

export function hashBusinessPayload(payload: Record<string, unknown>): string {
  const businessPayload = Object.fromEntries(
    Object.entries(payload).filter(([key]) => !TRANSPORT_KEYS.has(key)),
  );

  return createHash('sha256').update(canonicalJson(businessPayload)).digest('hex');
}
