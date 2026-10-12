export type { TarkovTrader, TarkovMap, TaskObjective, TaskStatusRequirement, TarkovTask } from "./tarkovData/types.js";
export { fetchTasks, TARKOV_DEV_GRAPHQL_URL } from "./tarkovData/client.js";
export { fetchTasksFromJson, convertJsonFeed, TARKOV_DEV_JSON_BASE_URL } from "./tarkovData/jsonClient.js";
export type { JsonFeed, FetchTasksFromJsonOptions } from "./tarkovData/jsonClient.js";
export { DEFAULT_GAME_MODE, parseGameMode } from "./tarkovData/gameMode.js";
export type { GameMode } from "./tarkovData/gameMode.js";
export { saveCache, loadCache, isStale, CACHE_VERSION } from "./tarkovData/cache.js";
export type { TaskCache } from "./tarkovData/cache.js";
export { deriveStorylines } from "./storylines/deriveStorylines.js";
export type { Storyline } from "./storylines/deriveStorylines.js";
export { ProgressStore } from "./progress/store.js";
export type { TaskStatus } from "./progress/store.js";
export { listSessionFolders, findLatestSession, findLogFile } from "./logWatcher/discovery.js";
export type { SessionInfo, LogFileKind } from "./logWatcher/discovery.js";
export { parseLogLine, logLineTimestamp } from "./logWatcher/logLine.js";
export type { ParsedLogLine } from "./logWatcher/logLine.js";
export { extractNotificationEvents } from "./logWatcher/notificationEvents.js";
export type { NotificationEvent } from "./logWatcher/notificationEvents.js";
export { extractRaidStartEvents } from "./logWatcher/raidStartEvents.js";
export type { RaidStartEvent } from "./logWatcher/raidStartEvents.js";
export { applySessionToStore } from "./logWatcher/applySession.js";
export type { ApplySessionResult } from "./logWatcher/applySession.js";
export { runBackfill } from "./logWatcher/backfill.js";
export type { BackfillResult } from "./logWatcher/backfill.js";
export { LogTailer } from "./logWatcher/liveTail.js";
export type { LogTailerOptions } from "./logWatcher/liveTail.js";

import { fetchTasks } from "./tarkovData/client.js";
import { fetchTasksFromJson } from "./tarkovData/jsonClient.js";
import { loadCache, saveCache, isStale } from "./tarkovData/cache.js";
import { DEFAULT_GAME_MODE, type GameMode } from "./tarkovData/gameMode.js";
import type { TarkovTask } from "./tarkovData/types.js";

export interface SyncOptions {
  maxAgeMs?: number;
  fetchImpl?: typeof fetch;
  now?: Date;
  gameMode?: GameMode;
}

export const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Fetches the task graph from the network. Tries tarkov.dev's JSON feed
 * first (it's what the live site runs on, and was the only thing working when
 * this was written), then the GraphQL API for if/when that comes back. If
 * both fail, the error names both causes so the failure is diagnosable.
 */
async function fetchFreshTasks(gameMode: GameMode, fetchImpl?: typeof fetch): Promise<TarkovTask[]> {
  try {
    return await fetchTasksFromJson({ gameMode, fetchImpl });
  } catch (jsonError) {
    try {
      return await fetchTasks(fetchImpl, gameMode);
    } catch (graphqlError) {
      throw new Error(
        `Could not fetch quest data. JSON feed: ${describeError(jsonError)}. GraphQL API: ${describeError(graphqlError)}`
      );
    }
  }
}

function hasItemData(tasks: TarkovTask[]): boolean {
  return tasks.some((task) => task.objectives.some((objective) => objective.bring !== undefined));
}

/**
 * Returns the current task graph for one game mode (PvE by default),
 * preferring a fresh local cache over a network call. If the cache is
 * missing or stale, fetches and refreshes it. If every source fails and a
 * cache exists — even a stale one — falls back to the cached tasks so the
 * app keeps working offline, per the spec's error-handling requirement. Only
 * throws if there is no usable cache and every source also fails.
 *
 * A cache built for a different game mode is never "usable": serving PvE
 * quests to someone who asked for regular (or the reverse) would look like
 * the app working while being wrong.
 */
export async function syncTaskGraph(cachePath: string, options: SyncOptions = {}): Promise<TarkovTask[]> {
  const { maxAgeMs = DEFAULT_MAX_AGE_MS, fetchImpl, now = new Date(), gameMode = DEFAULT_GAME_MODE } = options;
  const loaded = loadCache(cachePath);
  const cached = loaded && loaded.gameMode === gameMode ? loaded : null;

  // A saved copy from before the "what to bring" lists existed is refreshed once, even if it's recent.
  if (cached && !isStale(cached.fetchedAt, maxAgeMs, now) && hasItemData(cached.tasks)) {
    return cached.tasks;
  }

  try {
    const tasks = await fetchFreshTasks(gameMode, fetchImpl);
    saveCache(cachePath, tasks, now, gameMode);
    return tasks;
  } catch (error) {
    if (cached) {
      return cached.tasks;
    }
    throw error;
  }
}
