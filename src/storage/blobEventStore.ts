import { get, list, put } from '@vercel/blob';
import type { SharvaTaskEvent } from '../types';

const DEFAULT_PREFIX = 'sharvatask-v2/events';

function prefix(): string {
  return (process.env.SHARVATASK_BLOB_PREFIX || DEFAULT_PREFIX).replace(/^\/+|\/+$/g, '');
}

function safeTimestamp(value = new Date()): string {
  return value.toISOString().replace(/[:.]/g, '-');
}

export function newId(prefixValue: string): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefixValue}-${Date.now().toString(36)}-${randomPart}`.toUpperCase();
}

export async function writeEvent(event: SharvaTaskEvent): Promise<void> {
  const pathname = `${prefix()}/${safeTimestamp(new Date(event.event_time))}_${event.event_id}.json`;
  await put(pathname, JSON.stringify(event, null, 2), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false
  });
}

async function streamToText(stream: ReadableStream<Uint8Array>): Promise<string> {
  return await new Response(stream).text();
}

async function readEvent(pathname: string): Promise<SharvaTaskEvent | null> {
  try {
    const result = await get(pathname, { access: 'private' });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const text = await streamToText(result.stream);
    return JSON.parse(text) as SharvaTaskEvent;
  } catch {
    return null;
  }
}

export async function readAllEvents(): Promise<SharvaTaskEvent[]> {
  const events: SharvaTaskEvent[] = [];
  let cursor: string | undefined;

  do {
    const result = await list({ prefix: `${prefix()}/`, limit: 1000, cursor });
    for (const blob of result.blobs) {
      if (!blob.pathname.endsWith('.json')) continue;
      const event = await readEvent(blob.pathname);
      if (event) events.push(event);
    }
    cursor = result.cursor;
    if (!result.hasMore) break;
  } while (cursor);

  return events.sort((a, b) => a.event_time.localeCompare(b.event_time));
}

export function createEvent(action: SharvaTaskEvent['action'], listId: string, payload: Record<string, unknown>): SharvaTaskEvent {
  return {
    event_id: newId('EVT'),
    event_time: new Date().toISOString(),
    list_id: listId,
    action,
    payload
  };
}
