import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { TarkovTask } from "./types.js";

export interface TaskCache {
  fetchedAt: string;
  tasks: TarkovTask[];
}

export function saveCache(cachePath: string, tasks: TarkovTask[], now: Date = new Date()): void {
  const cache: TaskCache = { fetchedAt: now.toISOString(), tasks };
  writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf-8");
}

export function loadCache(cachePath: string): TaskCache | null {
  if (!existsSync(cachePath)) {
    return null;
  }
  const raw = readFileSync(cachePath, "utf-8");
  return JSON.parse(raw) as TaskCache;
}

export function isStale(fetchedAt: string, maxAgeMs: number, now: Date = new Date()): boolean {
  const fetchedTime = new Date(fetchedAt).getTime();
  return now.getTime() - fetchedTime > maxAgeMs;
}
