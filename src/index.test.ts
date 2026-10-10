import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncTaskGraph, deriveStorylines, ProgressStore, convertJsonFeed, loadCache } from "./index.js";
import type { TarkovTask } from "./tarkovData/types.js";
import { jsonFeedSample } from "./tarkovData/__fixtures__/jsonFeedSample.js";
import { createFakeFeedFetch } from "./tarkovData/__fixtures__/fakeFeedFetch.js";

// What a successful JSON-feed sync should return for the real captured sample.
const expectedTasks = convertJsonFeed(jsonFeedSample);

// A GraphQL-shaped task list, for the fallback path.
const graphqlTasks: TarkovTask[] = [
  {
    id: "gql-1",
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

function newCachePath(): string {
  tempDir = mkdtempSync(join(tmpdir(), "tarkov-index-test-"));
  return join(tempDir, "cache.json");
}

describe("syncTaskGraph", () => {
  it("fetches from the JSON feed and caches on a cold cache, then serves the cache on a warm call", async () => {
    const cachePath = newCachePath();
    const fake = createFakeFeedFetch();

    const first = await syncTaskGraph(cachePath, { fetchImpl: fake.fetchImpl });
    expect(first).toEqual(expectedTasks);
    expect(fake.jsonSyncCount()).toBe(1);

    const second = await syncTaskGraph(cachePath, { fetchImpl: fake.fetchImpl });
    expect(second).toEqual(expectedTasks);
    expect(fake.jsonSyncCount()).toBe(1);
  });

  it("uses the JSON feed first and never touches GraphQL when the feed works", async () => {
    const fake = createFakeFeedFetch({ graphqlTasks });

    await syncTaskGraph(newCachePath(), { fetchImpl: fake.fetchImpl });

    expect(fake.graphqlRequestCount()).toBe(0);
  });

  it("falls back to GraphQL, for the same game mode, when the JSON feed is down", async () => {
    const fake = createFakeFeedFetch({ jsonStatus: 503, graphqlTasks });

    const result = await syncTaskGraph(newCachePath(), { fetchImpl: fake.fetchImpl, gameMode: "regular" });

    expect(result).toEqual(graphqlTasks);
    expect(fake.graphqlRequestCount()).toBe(1);
    expect(fake.graphqlBodies[0]).toContain("gameMode: regular");
  });

  it("refetches when the cache is stale", async () => {
    const cachePath = newCachePath();
    const fake = createFakeFeedFetch();

    await syncTaskGraph(cachePath, { fetchImpl: fake.fetchImpl, now: new Date("2026-01-01T00:00:00.000Z") });
    await syncTaskGraph(cachePath, {
      fetchImpl: fake.fetchImpl,
      now: new Date("2026-01-03T00:00:00.000Z"),
      maxAgeMs: 24 * 60 * 60 * 1000,
    });

    expect(fake.jsonSyncCount()).toBe(2);
  });

  it("falls back to a stale cache when every source fails", async () => {
    const cachePath = newCachePath();
    await syncTaskGraph(cachePath, {
      fetchImpl: createFakeFeedFetch().fetchImpl,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const result = await syncTaskGraph(cachePath, {
      fetchImpl: createFakeFeedFetch({ jsonStatus: 500 }).fetchImpl,
      now: new Date("2026-01-03T00:00:00.000Z"),
      maxAgeMs: 24 * 60 * 60 * 1000,
    });

    expect(result).toEqual(expectedTasks);
  });

  it("throws an error naming both sources when everything fails and there is no cache", async () => {
    const fake = createFakeFeedFetch({ jsonStatus: 503 });

    await expect(syncTaskGraph(newCachePath(), { fetchImpl: fake.fetchImpl })).rejects.toThrow(
      /JSON feed:.*503.*GraphQL API:.*422/
    );
  });

  it("asks the JSON feed for the PvE task list by default", async () => {
    const fake = createFakeFeedFetch();

    await syncTaskGraph(newCachePath(), { fetchImpl: fake.fetchImpl });

    expect(fake.calls.every((url) => url.includes("/pve/"))).toBe(true);
  });

  it("asks for the regular task list when told to, and caches it as regular", async () => {
    const cachePath = newCachePath();
    const fake = createFakeFeedFetch();

    await syncTaskGraph(cachePath, { fetchImpl: fake.fetchImpl, gameMode: "regular" });

    expect(fake.calls.every((url) => url.includes("/regular/"))).toBe(true);
    expect(loadCache(cachePath)?.gameMode).toBe("regular");
  });

  it("does not serve a fresh cache that was built for a different game mode", async () => {
    const cachePath = newCachePath();
    const fake = createFakeFeedFetch();

    await syncTaskGraph(cachePath, { fetchImpl: fake.fetchImpl, gameMode: "pve" });
    await syncTaskGraph(cachePath, { fetchImpl: fake.fetchImpl, gameMode: "regular" });

    expect(fake.jsonSyncCount()).toBe(2);
    expect(loadCache(cachePath)?.gameMode).toBe("regular");
  });

  it("does not use a cache from a different game mode as an offline fallback either", async () => {
    const cachePath = newCachePath();
    await syncTaskGraph(cachePath, { fetchImpl: createFakeFeedFetch().fetchImpl, gameMode: "pve" });

    // Showing PvE quests to someone who asked for regular would look like the
    // app working while being wrong, so this must fail loudly instead.
    await expect(
      syncTaskGraph(cachePath, {
        fetchImpl: createFakeFeedFetch({ jsonStatus: 503 }).fetchImpl,
        gameMode: "regular",
      })
    ).rejects.toThrow(/Could not fetch quest data/);
  });

  it("leaves the existing cache untouched when a refresh fails", async () => {
    const cachePath = newCachePath();
    await syncTaskGraph(cachePath, {
      fetchImpl: createFakeFeedFetch().fetchImpl,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const before = readFileSync(cachePath, "utf-8");

    await syncTaskGraph(cachePath, {
      fetchImpl: createFakeFeedFetch({ jsonStatus: 500 }).fetchImpl,
      now: new Date("2026-01-03T00:00:00.000Z"),
    });

    expect(readFileSync(cachePath, "utf-8")).toBe(before);
    expect(existsSync(`${cachePath}.tmp`)).toBe(false);
  });
});

describe("end-to-end composition", () => {
  it("wires fetch -> cache -> storyline derivation -> progress store using real task ids", async () => {
    const cachePath = newCachePath();
    const fake = createFakeFeedFetch();

    const tasks = await syncTaskGraph(cachePath, { fetchImpl: fake.fetchImpl });
    const storylines = deriveStorylines(tasks);
    const kappaStoryline = storylines.find((s) => s.id === "kappa");
    // "Chemical - Part 3" is the real Kappa-required task in the captured sample.
    expect(kappaStoryline?.taskIds).toContain("597a0e5786f77426d66c0636");

    const store = new ProgressStore(":memory:");
    for (const taskId of kappaStoryline?.taskIds ?? []) {
      store.recordEvent(taskId, "accepted");
    }
    expect(store.getStatus("597a0e5786f77426d66c0636")).toBe("accepted");
    store.close();
  });
});
