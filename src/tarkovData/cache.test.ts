import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveCache, loadCache, isStale, CACHE_VERSION } from "./cache.js";
import type { TarkovTask } from "./types.js";

const sampleTasks: TarkovTask[] = [
  {
    id: "1",
    name: "Debut",
    trader: { id: "t1", name: "Prapor" },
    map: null,
    wikiLink: "https://escapefromtarkov.fandom.com/wiki/Debut",
    kappaRequired: false,
    lightkeeperRequired: false,
    factionName: "Any",
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
  it("round-trips tasks, a fetchedAt timestamp, and the cache version", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-cache-test-"));
    const cachePath = join(tempDir, "cache.json");
    const now = new Date("2026-01-01T00:00:00.000Z");

    saveCache(cachePath, sampleTasks, now);
    const loaded = loadCache(cachePath);

    expect(loaded).not.toBeNull();
    expect(loaded?.tasks).toEqual(sampleTasks);
    expect(loaded?.fetchedAt).toBe(now.toISOString());
    expect(loaded?.version).toBe(CACHE_VERSION);
  });

  it("returns null when the cache file does not exist", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-cache-test-"));
    const cachePath = join(tempDir, "missing.json");

    expect(loadCache(cachePath)).toBeNull();
  });

  it("returns null instead of throwing when the cache file is corrupt", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-cache-test-"));
    const cachePath = join(tempDir, "corrupt.json");
    writeFileSync(cachePath, "{ this is not valid json", "utf-8");

    expect(loadCache(cachePath)).toBeNull();
  });

  it("returns null when the cache file has an incompatible version", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-cache-test-"));
    const cachePath = join(tempDir, "old-version.json");
    writeFileSync(
      cachePath,
      JSON.stringify({ version: 0, fetchedAt: new Date().toISOString(), tasks: sampleTasks }),
      "utf-8"
    );

    expect(loadCache(cachePath)).toBeNull();
  });

  it("does not leave a temp file behind after a successful save", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-cache-test-"));
    const cachePath = join(tempDir, "cache.json");

    saveCache(cachePath, sampleTasks);

    expect(existsSync(`${cachePath}.tmp`)).toBe(false);
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
