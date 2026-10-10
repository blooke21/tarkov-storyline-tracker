import { describe, it, expect, afterEach } from "vitest";
import { ProgressStore } from "../progress/store.js";
import { buildPrestigeResponse, setPrestigeCondition, setPrestigeLevel } from "./prestigeApi.js";
import type { PrestigeApiDeps } from "./prestigeApi.js";
import { HttpError } from "./createServer.js";
import type { PrestigeLevel } from "../prestige/prestigeData.js";
import { sampleTasks } from "../tarkovData/__fixtures__/sampleTasks.js";

const levels: PrestigeLevel[] = [
  {
    level: 1,
    conditions: [
      { id: "p1-level", kind: "playerLevel", level: 15 },
      { id: "p1-money", kind: "haveItem", item: "Roubles", count: 5000000 },
    ],
  },
  {
    level: 2,
    conditions: [
      { id: "p2-skill", kind: "skill", skill: "Strength", level: 10 },
      { id: "p2-station", kind: "hideoutStation", station: "Rest Space", level: 2 },
      { id: "p2-quest", kind: "task", taskId: "sample-1" },
    ],
  },
];

let store: ProgressStore | undefined;
afterEach(() => {
  store?.close();
  store = undefined;
});

function setUp(available = levels): PrestigeApiDeps {
  store = new ProgressStore(":memory:");
  return { store, getLevels: () => available, getTasks: () => sampleTasks };
}

describe("buildPrestigeResponse", () => {
  it("starts at prestige 0 and shows what prestige 1 needs, in plain words", () => {
    const response = buildPrestigeResponse(setUp());

    expect(response).toMatchObject({ available: true, current: 0, maxLevel: 2 });
    expect(response.next?.level).toBe(1);
    expect(response.next?.conditions.map((c) => c.text)).toEqual(["Reach player level 15", "Have 5,000,000 Roubles"]);
    expect(response.next).toMatchObject({ doneCount: 0, total: 2 });
  });

  it("says the requirements are unavailable when there are none", () => {
    const response = buildPrestigeResponse(setUp([]));

    expect(response).toMatchObject({ available: false, current: 0, next: null });
  });

  it("checks quest requirements automatically from quest progress, naming the quest", () => {
    const deps = setUp();
    setPrestigeLevel(deps, "1");

    const before = buildPrestigeResponse(deps).next!.conditions.find((c) => c.id === "p2-quest")!;
    expect(before).toMatchObject({ automatic: true, done: false });
    expect(before.text).toBe('Complete the quest "Debut"');

    deps.store.recordEvent("sample-1", "completed");

    expect(buildPrestigeResponse(deps).next!.conditions.find((c) => c.id === "p2-quest")?.done).toBe(true);
  });

  it("has nothing next once the player is at the top level", () => {
    const deps = setUp();

    const response = setPrestigeLevel(deps, "2");

    expect(response.current).toBe(2);
    expect(response.next).toBeNull();
  });
});

describe("setPrestigeLevel", () => {
  it("moves to a level and starts that level's checklist fresh", () => {
    const deps = setUp();
    setPrestigeCondition(deps, "p1-level", true);

    const response = setPrestigeLevel(deps, "1");

    expect(response.current).toBe(1);
    expect(response.next?.level).toBe(2);
    expect(response.next?.doneCount).toBe(0);
  });

  it("rejects levels that aren't whole numbers within range", () => {
    const deps = setUp();

    for (const bad of [null, "", "x", "-1", "3", "1.5"]) {
      expect(() => setPrestigeLevel(deps, bad)).toThrow(/level/);
    }
    expect(buildPrestigeResponse(deps).current).toBe(0);
  });
});

describe("setPrestigeCondition", () => {
  it("ticks a requirement off and back on", () => {
    const deps = setUp();

    const ticked = setPrestigeCondition(deps, "p1-level", true);
    expect(ticked.next?.conditions.map((c) => c.done)).toEqual([true, false]);
    expect(ticked.next?.doneCount).toBe(1);

    const unticked = setPrestigeCondition(deps, "p1-level", false);
    expect(unticked.next?.doneCount).toBe(0);
  });

  it("refuses a requirement that's checked automatically (400) or doesn't exist (404)", () => {
    const deps = setUp();
    setPrestigeLevel(deps, "1");

    expect(() => setPrestigeCondition(deps, "p2-quest", true)).toThrow(/automatically/);
    expect(() => setPrestigeCondition(deps, "nope", true)).toThrow(HttpError);
    // A requirement of a different level isn't the one being worked on.
    expect(() => setPrestigeCondition(deps, "p1-level", true)).toThrow(/Unknown/);
  });

  it("survives a corrupted saved value", () => {
    const deps = setUp();
    deps.store.setMeta("prestigeProgress", "{nope");

    expect(buildPrestigeResponse(deps).current).toBe(0);
  });

  it("is kept when the player resets their character (prestige belongs to the account)", () => {
    const deps = setUp();
    setPrestigeLevel(deps, "1");

    deps.store.resetProgress(new Date());

    expect(buildPrestigeResponse(deps).current).toBe(1);
  });
});
