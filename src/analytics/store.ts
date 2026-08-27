/**
 * Local analytics store: append-only ring buffer over chrome.storage.local.
 * Deliberately simple (doc §4): events are small, volume is bounded
 * (MAX_EVENTS), and aggregation is computed once per snapshot read.
 *
 * Concurrency: appends are serialized through the exclusive mutex and are
 * idempotent per eventId, so a journaled event replayed after a service-worker
 * restart can never double-count.
 */

import { withExclusiveLock } from "../core/mutex";
import { STORAGE_KEYS, local } from "../core/storage";
import type { UsageEvent } from "../shared/types";
import { MAX_EVENTS, isValidEvent } from "./events";

/**
 * Append without taking the mutex — for callers already inside
 * withExclusiveLock (e.g. the test pipeline's post-fetch section).
 */
export async function appendEventsUnsafe(events: UsageEvent[]): Promise<void> {
  if (events.length === 0) return;
  const existing = await loadEvents();
  const known = new Set(existing.map((e) => e.eventId));
  const fresh = events.filter((e) => !known.has(e.eventId));
  if (fresh.length === 0) return;
  const merged = [...existing, ...fresh];
  // Keep the newest MAX_EVENTS entries.
  const trimmed = merged.length > MAX_EVENTS ? merged.slice(merged.length - MAX_EVENTS) : merged;
  await local().set(STORAGE_KEYS.analyticsEvents, trimmed);
}

/** Mutex-serialized, idempotent append. */
export async function appendEvents(events: UsageEvent[]): Promise<void> {
  await withExclusiveLock(() => appendEventsUnsafe(events));
}

export async function loadEvents(): Promise<UsageEvent[]> {
  const raw = await local().get<unknown[]>(STORAGE_KEYS.analyticsEvents);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidEvent).sort((a, b) => a.timestamp - b.timestamp);
}

export async function clearAnalytics(): Promise<void> {
  await local().remove(STORAGE_KEYS.analyticsEvents);
}

export async function analyticsCount(): Promise<number> {
  return (await local().get<UsageEvent[]>(STORAGE_KEYS.analyticsEvents))?.length ?? 0;
}
