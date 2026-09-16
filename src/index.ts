export type { TarkovTrader, TarkovMap, TaskObjective, TaskStatusRequirement, TarkovTask } from "./tarkovData/types.js";
export { fetchTasks, TARKOV_DEV_GRAPHQL_URL } from "./tarkovData/client.js";
export { saveCache, loadCache, isStale, CACHE_VERSION } from "./tarkovData/cache.js";
export type { TaskCache } from "./tarkovData/cache.js";
export { deriveStorylines } from "./storylines/deriveStorylines.js";
export type { Storyline } from "./storylines/deriveStorylines.js";
export { ProgressStore } from "./progress/store.js";
export type { TaskStatus } from "./progress/store.js";

import { fetchTasks } from "./tarkovData/client.js";
import { loadCache, saveCache, isStale } from "./tarkovData/cache.js";
import type { TarkovTask } from "./tarkovData/types.js";

export interface SyncOptions {
  maxAgeMs?: number;
  fetchImpl?: typeof fetch;
  now?: Date;
}

export const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Returns the current tarkov.dev task graph, preferring a fresh local
 * cache over a network call. If the cache is missing or stale, fetches
 * from tarkov.dev and refreshes the cache. If that fetch fails (e.g. the
 * API is unreachable) and a cache exists — even a stale one — falls back
 * to the cached tasks so the app keeps working offline, per the spec's
 * error-handling requirement. Only throws if there is no usable cache
 * and the fetch also fails.
 */
export async function syncTaskGraph(cachePath: string, options: SyncOptions = {}): Promise<TarkovTask[]> {
  const { maxAgeMs = DEFAULT_MAX_AGE_MS, fetchImpl, now = new Date() } = options;
  const cached = loadCache(cachePath);

  if (cached && !isStale(cached.fetchedAt, maxAgeMs, now)) {
    return cached.tasks;
  }

  try {
    const tasks = await fetchTasks(fetchImpl);
    saveCache(cachePath, tasks, now);
    return tasks;
  } catch (error) {
    if (cached) {
      return cached.tasks;
    }
    throw error;
  }
}
