import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncTaskGraph, deriveStorylines, ProgressStore } from "./index.js";
import type { TarkovTask } from "./tarkovData/types.js";

const sampleTasks: TarkovTask[] = [
  {
    id: "1",
    name: "Debut",
    trader: { id: "t1", name: "Prapor" },
    map: null,
    wikiLink: "https://escapefromtarkov.fandom.com/wiki/Debut",
    kappaRequired: true,
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

describe("syncTaskGraph", () => {
  it("fetches and caches tasks on a cold cache, then serves the cache on a warm call", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-index-test-"));
    const cachePath = join(tempDir, "cache.json");
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { tasks: sampleTasks } }),
    });

    const first = await syncTaskGraph(cachePath, { fetchImpl: fakeFetch as unknown as typeof fetch });
    expect(first).toEqual(sampleTasks);
    expect(fakeFetch).toHaveBeenCalledTimes(1);

    const second = await syncTaskGraph(cachePath, { fetchImpl: fakeFetch as unknown as typeof fetch });
    expect(second).toEqual(sampleTasks);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it("refetches when the cache is stale", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-index-test-"));
    const cachePath = join(tempDir, "cache.json");
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { tasks: sampleTasks } }),
    });

    await syncTaskGraph(cachePath, {
      fetchImpl: fakeFetch as unknown as typeof fetch,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    await syncTaskGraph(cachePath, {
      fetchImpl: fakeFetch as unknown as typeof fetch,
      now: new Date("2026-01-03T00:00:00.000Z"),
      maxAgeMs: 24 * 60 * 60 * 1000,
    });

    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it("falls back to a stale cache when the network fetch fails", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-index-test-"));
    const cachePath = join(tempDir, "cache.json");
    const workingFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { tasks: sampleTasks } }),
    });
    await syncTaskGraph(cachePath, {
      fetchImpl: workingFetch as unknown as typeof fetch,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const failingFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Internal Server Error" });
    const result = await syncTaskGraph(cachePath, {
      fetchImpl: failingFetch as unknown as typeof fetch,
      now: new Date("2026-01-03T00:00:00.000Z"),
      maxAgeMs: 24 * 60 * 60 * 1000,
    });

    expect(result).toEqual(sampleTasks);
  });

  it("throws when the fetch fails and there is no cache to fall back to", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-index-test-"));
    const cachePath = join(tempDir, "cache.json");
    const failingFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Internal Server Error" });

    await expect(
      syncTaskGraph(cachePath, { fetchImpl: failingFetch as unknown as typeof fetch })
    ).rejects.toThrow("tarkov.dev API request failed");
  });
});

describe("end-to-end composition", () => {
  it("wires fetch -> cache -> storyline derivation -> progress store using real task ids", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-index-test-"));
    const cachePath = join(tempDir, "cache.json");
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { tasks: sampleTasks } }),
    });

    const tasks = await syncTaskGraph(cachePath, { fetchImpl: fakeFetch as unknown as typeof fetch });
    const storylines = deriveStorylines(tasks);
    const kappaStoryline = storylines.find((s) => s.id === "kappa");
    expect(kappaStoryline?.taskIds).toContain("1");

    const store = new ProgressStore(":memory:");
    for (const taskId of kappaStoryline?.taskIds ?? []) {
      store.recordEvent(taskId, "accepted");
    }
    expect(store.getStatus("1")).toBe("accepted");
    store.close();
  });
});
