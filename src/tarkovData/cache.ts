import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { DEFAULT_GAME_MODE, type GameMode } from "./gameMode.js";
import type { TarkovTask } from "./types.js";

// Version 2 added `gameMode`. Bumping the version is what makes an existing
// version-1 cache file get discarded and refetched instead of being served
// as if it were PvE (or regular) data it was never labelled as.
export const CACHE_VERSION = 2;

export interface TaskCache {
  version: number;
  gameMode: GameMode;
  fetchedAt: string;
  tasks: TarkovTask[];
}

export function saveCache(
  cachePath: string,
  tasks: TarkovTask[],
  now: Date = new Date(),
  gameMode: GameMode = DEFAULT_GAME_MODE
): void {
  const cache: TaskCache = { version: CACHE_VERSION, gameMode, fetchedAt: now.toISOString(), tasks };
  const tempPath = `${cachePath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(cache, null, 2), "utf-8");
  renameSync(tempPath, cachePath);
}

export function loadCache(cachePath: string): TaskCache | null {
  if (!existsSync(cachePath)) {
    return null;
  }

  let parsed: unknown;
  try {
    const raw = readFileSync(cachePath, "utf-8");
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const cache = parsed as Partial<TaskCache>;
  if (
    cache.version !== CACHE_VERSION ||
    (cache.gameMode !== "pve" && cache.gameMode !== "regular") ||
    typeof cache.fetchedAt !== "string" ||
    !Array.isArray(cache.tasks)
  ) {
    return null;
  }

  return cache as TaskCache;
}

export function isStale(fetchedAt: string, maxAgeMs: number, now: Date = new Date()): boolean {
  const fetchedTime = new Date(fetchedAt).getTime();
  return now.getTime() - fetchedTime > maxAgeMs;
}
