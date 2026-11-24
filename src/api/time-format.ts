// Wire and snapshot dates use UTC. Domain services keep milliseconds for interval arithmetic.
const timestampFields = new Set([
  'at', 'start', 'end', 'capturedAt', 'lastSeenAt', 'observedAt', 'startAt', 'endAt', 'startedAt', 'endedAt',
  'expiresAt', 'createdAt', 'updatedAt', 'waitingSince', 'neededAt', 'openedAt', 'acknowledgedAt', 'resolvedAt',
  'departedAt', 'arrivedAt', 'finishedAt', 'dispatchedAt', 'nextProbeAt', 'readAt', 'occurredAt',
]);
const utcTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function formatTimestamp(key: string, value: unknown): unknown {
  return timestampFields.has(key) && typeof value === 'number' && Number.isFinite(value)
    ? new Date(value).toISOString()
    : value;
}

export function parseTimestamp(key: string, value: unknown): unknown {
  return timestampFields.has(key) && typeof value === 'string' && utcTimestamp.test(value)
    ? Date.parse(value)
    : value;
}
