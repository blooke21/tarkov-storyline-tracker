import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { TarkovTask } from "./types.js";

export const CACHE_VERSION = 1;

export interface TaskCache {
  version: number;
  fetchedAt: string;
  tasks: TarkovTask[];
}

export function saveCache(cachePath: string, tasks: TarkovTask[], now: Date = new Date()): void {
  const cache: TaskCache = { version: CACHE_VERSION, fetchedAt: now.toISOString(), tasks };
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
  if (cache.version !== CACHE_VERSION || typeof cache.fetchedAt !== "string" || !Array.isArray(cache.tasks)) {
    return null;
  }

  return cache as TaskCache;
}

export function isStale(fetchedAt: string, maxAgeMs: number, now: Date = new Date()): boolean {
  const fetchedTime = new Date(fetchedAt).getTime();
  return now.getTime() - fetchedTime > maxAgeMs;
}
