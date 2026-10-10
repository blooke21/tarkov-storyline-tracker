import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertPrestigeFeeds, fetchPrestige, syncPrestige } from "./prestigeData.js";
import type { PrestigeFeeds } from "./prestigeData.js";

const ROUBLES = "5449016a4bdc2d6f028b456f";

const feeds: PrestigeFeeds = {
  tasks: {
    data: {
      prestige: [
        {
          prestigeLevel: 2,
          conditions: [
            { id: "c1", type: "playerLevel", playerLevel: 25, count: 25 },
            { id: "c2", type: "skill", skill: "RecoilControl", level: 10 },
            { id: "c3", type: "hideoutStation", station: "st-rest", stationLevel: 2, count: 2 },
            { id: "c4", type: "haveItem", items: [ROUBLES], count: 10000000 },
          ],
        },
        {
          prestigeLevel: 1,
          conditions: [{ id: "d1", type: "taskStatus", task: "task-collector", count: null }],
        },
        { prestigeLevel: 3, conditions: [{ id: "e1", type: "somethingNew" }, { id: "e2", type: "taskStatus", count: null }] },
      ],
    },
  },
  hideout: { data: { "st-rest": { name: "hideout_area_9_name", normalizedName: "rest-space" } } },
  hideoutEn: { data: { hideout_area_9_name: "Rest Space" } },
};

describe("convertPrestigeFeeds", () => {
  it("turns the feeds into levels, lowest first, with readable names", () => {
    const levels = convertPrestigeFeeds(feeds);

    expect(levels.map((l) => l.level)).toEqual([1, 2, 3]);
    expect(levels[1].conditions).toEqual([
      { id: "c1", kind: "playerLevel", level: 25 },
      { id: "c2", kind: "skill", skill: "Recoil Control", level: 10 },
      { id: "c3", kind: "hideoutStation", station: "Rest Space", level: 2 },
      { id: "c4", kind: "haveItem", item: "Roubles", count: 10000000 },
    ]);
    expect(levels[0].conditions).toEqual([{ id: "d1", kind: "task", taskId: "task-collector" }]);
  });

  it("falls back to the station's slug when its translation is missing", () => {
    const levels = convertPrestigeFeeds({ ...feeds, hideoutEn: { data: {} } });

    expect(levels[1].conditions[2]).toMatchObject({ station: "Rest Space" });
  });

  it("keeps requirement types it doesn't know instead of dropping them", () => {
    const levels = convertPrestigeFeeds(feeds);

    expect(levels[2].conditions).toEqual([
      { id: "e1", kind: "other", text: "Requirement: somethingNew" },
      { id: "e2", kind: "other", text: "Finish a quest" },
    ]);
  });
});

function fakeFetch(options: { failing?: boolean } = {}): { fetchImpl: typeof fetch; calls: () => number } {
  let calls = 0;
  const fetchImpl = (async (input: string | URL) => {
    calls++;
    if (options.failing) {
      throw new TypeError("fetch failed");
    }
    const url = String(input);
    const body = url.endsWith("/hideout_en") ? feeds.hideoutEn : url.endsWith("/hideout") ? feeds.hideout : feeds.tasks;
    return new Response(JSON.stringify(body));
  }) as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

let tempDir: string | undefined;
afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});
const cachePath = () => {
  tempDir = mkdtempSync(join(tmpdir(), "tarkov-prestige-test-"));
  return join(tempDir, "prestige.json");
};

describe("fetchPrestige", () => {
  it("downloads the three feeds for the chosen game mode", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: string | URL) => {
      urls.push(String(input));
      return fakeFetch().fetchImpl(input);
    }) as typeof fetch;

    const levels = await fetchPrestige({ gameMode: "pve", fetchImpl });

    expect(levels).toHaveLength(3);
    expect(urls.sort()).toEqual([
      "https://json.tarkov.dev/pve/hideout",
      "https://json.tarkov.dev/pve/hideout_en",
      "https://json.tarkov.dev/pve/tasks",
    ]);
  });

  it("rejects a feed with no prestige section", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ data: {} }))) as typeof fetch;

    await expect(fetchPrestige({ fetchImpl })).rejects.toThrow(/prestige/);
  });
});

describe("syncPrestige", () => {
  it("downloads once, then serves a fresh cache without touching the network", async () => {
    const path = cachePath();
    const fake = fakeFetch();

    await syncPrestige(path, { fetchImpl: fake.fetchImpl });
    const again = await syncPrestige(path, { fetchImpl: fake.fetchImpl });

    expect(fake.calls()).toBe(3); // one download = three feeds
    expect(again).toHaveLength(3);
  });

  it("refreshes a stale cache, but falls back to it when the network is down", async () => {
    const path = cachePath();
    await syncPrestige(path, { fetchImpl: fakeFetch().fetchImpl, now: new Date("2026-10-01T00:00:00Z") });

    const levels = await syncPrestige(path, { fetchImpl: fakeFetch({ failing: true }).fetchImpl, now: new Date("2026-10-10T00:00:00Z") });

    expect(levels).toHaveLength(3);
  });

  it("returns nothing, instead of throwing, when there is no cache and no network", async () => {
    const path = cachePath();

    expect(await syncPrestige(path, { fetchImpl: fakeFetch({ failing: true }).fetchImpl })).toEqual([]);
    expect(existsSync(path)).toBe(false);
  });

  it("ignores a cache for the other game mode and a corrupted cache file", async () => {
    const path = cachePath();
    writeFileSync(path, "{not json");
    expect(await syncPrestige(path, { fetchImpl: fakeFetch({ failing: true }).fetchImpl })).toEqual([]);

    await syncPrestige(path, { fetchImpl: fakeFetch().fetchImpl, gameMode: "regular" });
    expect(await syncPrestige(path, { fetchImpl: fakeFetch({ failing: true }).fetchImpl, gameMode: "pve" })).toEqual([]);
  });
});
