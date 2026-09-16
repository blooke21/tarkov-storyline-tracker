import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveCache, loadCache, isStale } from "./cache.js";
import type { TarkovTask } from "./types.js";

const sampleTasks: TarkovTask[] = [
  {
    id: "1",
    name: "Debut",
    trader: { id: "t1", name: "Prapor" },
    wikiLink: "https://escapefromtarkov.fandom.com/wiki/Debut",
    kappaRequired: false,
    lightkeeperRequired: false,
    factionName: null,
    minPlayerLevel: 1,
    objectives: [],
    taskRequirements: [],
  },
];

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("saveCache / loadCache", () => {
  it("round-trips tasks and a fetchedAt timestamp", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-cache-test-"));
    const cachePath = join(tempDir, "cache.json");
    const now = new Date("2026-01-01T00:00:00.000Z");

    saveCache(cachePath, sampleTasks, now);
    const loaded = loadCache(cachePath);

    expect(loaded).not.toBeNull();
    expect(loaded?.tasks).toEqual(sampleTasks);
    expect(loaded?.fetchedAt).toBe(now.toISOString());
  });

  it("returns null when the cache file does not exist", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-cache-test-"));
    const cachePath = join(tempDir, "missing.json");

    expect(loadCache(cachePath)).toBeNull();
  });
});

describe("isStale", () => {
  it("returns false when the cache is younger than maxAgeMs", () => {
    const fetchedAt = new Date("2026-01-01T00:00:00.000Z").toISOString();
    const now = new Date("2026-01-01T01:00:00.000Z");
    expect(isStale(fetchedAt, 2 * 60 * 60 * 1000, now)).toBe(false);
  });

  it("returns true when the cache is older than maxAgeMs", () => {
    const fetchedAt = new Date("2026-01-01T00:00:00.000Z").toISOString();
    const now = new Date("2026-01-02T00:00:00.000Z");
    expect(isStale(fetchedAt, 60 * 60 * 1000, now)).toBe(true);
  });
});
