import { describe, it, expect } from "vitest";
import { convertJsonFeed, extractBring, fetchTasksFromJson, TARKOV_DEV_JSON_BASE_URL } from "./jsonClient.js";
import type { JsonFeed } from "./jsonClient.js";
import { jsonFeedSample } from "./__fixtures__/jsonFeedSample.js";
import { createFakeFeedFetch } from "./__fixtures__/fakeFeedFetch.js";
import { deriveStorylines } from "../storylines/deriveStorylines.js";

function byId(id: string) {
  const task = convertJsonFeed(jsonFeedSample).find((t) => t.id === id);
  if (!task) {
    throw new Error(`fixture is missing task ${id}`);
  }
  return task;
}

describe("convertJsonFeed (against real captured feed data)", () => {
  it("converts every task in the feed", () => {
    expect(convertJsonFeed(jsonFeedSample)).toHaveLength(Object.keys(jsonFeedSample.tasks).length);
  });

  it("resolves the task name, trader, and map from the translation files instead of leaving bare keys/ids", () => {
    const task = byId("657315ddab5a49b71f098853");

    expect(task.name).toBe("First in Line");
    expect(task.trader).toEqual({ id: "54cb57776803fa99248b456e", name: "Therapist" });
    expect(task.map?.name).toBe("Ground Zero");
    expect(task.wikiLink).toBe("https://escapefromtarkov.fandom.com/wiki/First_in_Line");
    expect(task.minPlayerLevel).toBe(1);
  });

  it("resolves objective descriptions (the feed gives only the objective's id as its 'description')", () => {
    const task = byId("657315ddab5a49b71f098853");

    expect(task.objectives.map((o) => o.description)).toEqual([
      "Locate the Emercom station on Ground Zero",
      "Hand over any found in raid medicine items",
    ]);
    expect(task.objectives.map((o) => o.type)).toEqual(["visit", "giveItem"]);
  });

  it("keeps an objective's optional flag", () => {
    const task = byId("6834233fecd5cf3a440d855b");

    expect(task.objectives.map((o) => o.optional)).toEqual([false, true, false, false]);
  });

  it("converts requirements from the feed's {task: id} shape to the app's {task: {id}} shape", () => {
    const task = byId("6834233fecd5cf3a440d855b");

    expect(task.taskRequirements).toEqual([
      { task: { id: "68341c4babec72d95d0c1260" }, status: ["complete"] },
      { task: { id: "697878057aa1273126030fb0" }, status: ["complete"] },
    ]);
  });

  it("maps a task with no map to null rather than an object with a missing name", () => {
    expect(byId("596a204686f774576d4c95de").map).toBeNull();
  });

  it("carries through faction and the kappa flag as served", () => {
    expect(byId("6613f3007f6666d56807c929").factionName).toBe("BEAR");
    expect(byId("66151401efb0539ae10875ae").factionName).toBe("USEC");
    expect(byId("597a0e5786f77426d66c0636").kappaRequired).toBe(true);
    expect(byId("657315ddab5a49b71f098853").kappaRequired).toBe(false);
  });

  it("falls back to the raw key when a translation is missing, rather than throwing or showing nothing", () => {
    const feed: JsonFeed = { ...jsonFeedSample, tasksEn: {}, tradersEn: {}, mapsEn: {} };

    const task = convertJsonFeed(feed).find((t) => t.id === "657315ddab5a49b71f098853");

    expect(task?.name).toBe("657315ddab5a49b71f098853 name");
    expect(task?.trader.name).toBe("54cb57776803fa99248b456e");
  });

  it("treats an empty-string translation as missing rather than showing a blank name", () => {
    const feed: JsonFeed = {
      ...jsonFeedSample,
      tasksEn: { ...jsonFeedSample.tasksEn, "657315ddab5a49b71f098853 name": "" },
    };

    const task = convertJsonFeed(feed).find((t) => t.id === "657315ddab5a49b71f098853");

    expect(task?.name).toBe("657315ddab5a49b71f098853 name");
  });

  it("tolerates a task missing optional fields instead of crashing the whole sync", () => {
    const feed: JsonFeed = {
      tasks: { bare: { id: "bare", name: "bare name", trader: "t1" } },
      tasksEn: {},
      tradersEn: {},
      mapsEn: {},
    };

    expect(convertJsonFeed(feed)).toEqual([
      {
        id: "bare",
        name: "bare name",
        trader: { id: "t1", name: "t1" },
        map: null,
        wikiLink: null,
        kappaRequired: false,
        lightkeeperRequired: false,
        factionName: null,
        minPlayerLevel: null,
        objectives: [],
        taskRequirements: [],
      },
    ]);
  });

  it("produces data the storyline deriver can use: every real task lands in at least one storyline", () => {
    const tasks = convertJsonFeed(jsonFeedSample);
    const covered = new Set(deriveStorylines(tasks).flatMap((s) => s.taskIds));

    expect(tasks.filter((t) => !covered.has(t.id))).toEqual([]);
  });
});

describe("fetchTasksFromJson", () => {
  it("defaults to the PvE feed and requests exactly the five files it needs", async () => {
    const fake = createFakeFeedFetch();

    await fetchTasksFromJson({ fetchImpl: fake.fetchImpl });

    expect([...fake.calls].sort()).toEqual(
      ["tasks", "tasks_en", "traders_en", "maps_en", "items_en"].map((f) => `${TARKOV_DEV_JSON_BASE_URL}/pve/${f}`).sort()
    );
  });

  it("requests the regular feed when asked", async () => {
    const fake = createFakeFeedFetch();

    await fetchTasksFromJson({ gameMode: "regular", fetchImpl: fake.fetchImpl });

    expect(fake.calls.every((url) => url.startsWith(`${TARKOV_DEV_JSON_BASE_URL}/regular/`))).toBe(true);
  });

  it("returns converted tasks", async () => {
    const fake = createFakeFeedFetch();

    const tasks = await fetchTasksFromJson({ fetchImpl: fake.fetchImpl });

    expect(tasks).toEqual(convertJsonFeed({ ...jsonFeedSample, itemsEn: {} }));
  });

  it("throws a clear error naming the file and status when a request fails", async () => {
    const fake = createFakeFeedFetch({ jsonStatus: 503 });

    await expect(fetchTasksFromJson({ fetchImpl: fake.fetchImpl })).rejects.toThrow(/\/pve\/\w+.*503/);
  });

  it("throws when the tasks file isn't an object keyed by task id (e.g. the old array shape)", async () => {
    const fetchImpl = (async (input: string | URL) => {
      const isTasks = String(input).endsWith("/tasks");
      return { ok: true, status: 200, statusText: "OK", json: async () => ({ data: isTasks ? { tasks: [] } : {} }) };
    }) as unknown as typeof fetch;

    await expect(fetchTasksFromJson({ fetchImpl })).rejects.toThrow(/tasks/);
  });

  it("throws when a response has no data field", async () => {
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({}),
    })) as unknown as typeof fetch;

    await expect(fetchTasksFromJson({ fetchImpl })).rejects.toThrow(/no data/);
  });
});

describe("extractBring (what to take into a raid)", () => {
  const items = {
    "marker-id Name": "MS2000 Marker",
    "chain-id Name": "Golden neck chain",
    "flare-red Name": "26x75mm flare cartridge (Red)",
    "flare-green Name": "26x75mm flare cartridge (Green)",
    "key-a Name": "Dorm room 114 key",
    "key-b Name": "Dorm room 214 key",
    "gun-1 Name": "M4A1",
    "vest-1 Name": "6B43 Zabralo-Sh body armor",
    "vest-2 Name": "6B13 assault armor",
  };
  const bring = (objective: Record<string, unknown>) => extractBring(objective, items);

  it("lists the marker for a mark objective, once per place it must be placed", () => {
    expect(bring({ type: "mark", markerItem: "marker-id", count: 3 })).toEqual([{ kind: "marker", names: ["MS2000 Marker"], count: 3 }]);
  });

  it("lists items to plant, with how many", () => {
    expect(bring({ type: "plantItem", items: ["chain-id"], count: 6 })).toEqual([{ kind: "item", names: ["Golden neck chain"], count: 6 }]);
  });

  it("offers every acceptable item for a use-any objective", () => {
    expect(bring({ type: "useItem", useAny: ["flare-red", "flare-green"] })).toEqual([
      { kind: "use", names: ["26x75mm flare cartridge (Red)", "26x75mm flare cartridge (Green)"], count: 1 },
    ]);
  });

  it("needs every key group, with any one key in a group being enough", () => {
    expect(bring({ type: "visit", requiredKeys: [["key-a", "key-b"], ["gun-1"]] })).toEqual([
      { kind: "key", names: ["Dorm room 114 key", "Dorm room 214 key"], count: 1 },
      { kind: "key", names: ["M4A1"], count: 1 },
    ]);
  });

  it("lists a required weapon and required gear for a kill, but not a long list of allowed weapons", () => {
    expect(bring({ type: "shoot", usingWeapon: ["gun-1"], wearing: [["vest-1", "vest-2"]] })).toEqual([
      { kind: "weapon", names: ["M4A1"], count: 1 },
      { kind: "gear", names: ["6B43 Zabralo-Sh body armor", "6B13 assault armor"], count: 1 },
    ]);
    const many = Array.from({ length: 10 }, (_, i) => `many-${i}`);
    const named = Object.fromEntries(many.map((id, i) => [`${id} Name`, `Weapon ${i}`]));
    expect(extractBring({ type: "shoot", usingWeapon: many }, named)).toEqual([]);
  });

  it("ignores items you hand in or find in the raid, and ids it can't name", () => {
    expect(bring({ type: "giveItem", items: ["chain-id"], count: 2 })).toEqual([]);
    expect(bring({ type: "findItem", items: ["chain-id"] })).toEqual([]);
    expect(bring({ type: "plantItem", items: ["unknown-id"], count: 1 })).toEqual([]);
  });

  it("is attached to each objective when item names are available, and left off when they aren't", () => {
    const withNames = convertJsonFeed({ ...jsonFeedSample, itemsEn: {} });
    const without = convertJsonFeed(jsonFeedSample);

    expect(withNames.every((t) => t.objectives.every((o) => Array.isArray(o.bring)))).toBe(true);
    expect(without.every((t) => t.objectives.every((o) => o.bring === undefined))).toBe(true);
  });

  it("carries a marker objective's item through a full conversion", () => {
    const feed: JsonFeed = {
      tasks: {
        t1: {
          id: "t1",
          name: "t1 name",
          trader: "tr",
          objectives: [{ id: "o1", type: "mark", markerItem: "marker-id", count: 2, description: "o1" }],
        },
      },
      tasksEn: { "t1 name": "Wet Job", o1: "Mark 2 spots" },
      tradersEn: {},
      mapsEn: {},
      itemsEn: items,
    };

    expect(convertJsonFeed(feed)[0].objectives[0].bring).toEqual([{ kind: "marker", names: ["MS2000 Marker"], count: 2 }]);
  });
});
