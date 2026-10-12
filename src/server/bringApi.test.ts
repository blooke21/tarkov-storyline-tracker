import { describe, it, expect, afterEach } from "vitest";
import { ProgressStore } from "../progress/store.js";
import { buildBringResponse } from "./bringApi.js";
import type { BringApiDeps } from "./bringApi.js";
import { setPinned } from "./pinsApi.js";
import type { BringRequirement, TarkovTask } from "../tarkovData/types.js";
import type { QuestGuide } from "../wiki/questGuide.js";

function task(id: string, name: string, objectives: Array<{ bring?: BringRequirement[]; optional?: boolean }>): TarkovTask {
  return {
    id,
    name,
    trader: { id: "t", name: "Prapor" },
    map: null,
    wikiLink: null,
    kappaRequired: false,
    lightkeeperRequired: false,
    factionName: "Any",
    minPlayerLevel: null,
    objectives: objectives.map((o, i) => ({ id: `${id}-${i}`, type: "x", description: "d", optional: o.optional ?? false, bring: o.bring })),
    taskRequirements: [],
  };
}

const marker = (count: number): BringRequirement => ({ kind: "marker", names: ["MS2000 Marker"], count });
const key: BringRequirement = { kind: "key", names: ["Dorm room 114 key"], count: 1 };

const tasks = [
  task("wet", "Wet Job - Part 2", [{ bring: [marker(1)] }, { bring: [marker(1)] }, { bring: [key] }, { bring: [key] }]),
  task("plain", "Debut", [{ bring: [] }]),
  task("opt", "Optional Thing", [{ bring: [marker(1)], optional: true }]),
  task("old", "Saved Before Item Lists", [{}]),
  task("air", "Airmail", [{ bring: [{ kind: "use", names: ["26x75mm flare cartridge (Red)"], count: 1 }] }]),
];

let store: ProgressStore | undefined;
afterEach(() => {
  store?.close();
  store = undefined;
});

function setUp(pinned: string[], extra: Partial<BringApiDeps> = {}): BringApiDeps {
  store = new ProgressStore(":memory:");
  const deps: BringApiDeps = { store, getTasks: () => tasks, ...extra };
  for (const id of pinned) {
    setPinned({ store, getTasks: deps.getTasks }, id, true);
  }
  return deps;
}

const guideWith = (rows: Array<{ name: string; amount: string; note: string }>): QuestGuide => ({
  wikiUrl: "https://w.test/x",
  found: true,
  rewards: [],
  sections: [{ title: "Guide", blocks: [{ kind: "items", items: rows }] }],
});

describe("buildBringResponse", () => {
  it("lists what a pinned quest needs, adding up markers and counting a key once", async () => {
    const response = await buildBringResponse(setUp(["wet"]));

    expect(response.quests).toEqual([
      { taskId: "wet", name: "Wet Job - Part 2", items: [{ text: "2× MS2000 Marker", note: null }, { text: "Dorm room 114 key", note: null }] },
    ]);
  });

  it("leaves out quests that aren't pinned, need nothing, are finished, or only need things for optional objectives", async () => {
    const deps = setUp(["plain", "opt", "old", "wet"]);
    deps.store.recordEvent("wet", "completed");

    expect((await buildBringResponse(deps)).quests).toEqual([]);
    expect((await buildBringResponse(setUp([]))).quests).toEqual([]);
  });

  it("keeps the order the quests were pinned in", async () => {
    const response = await buildBringResponse(setUp(["air", "wet"]));

    expect(response.quests.map((q) => q.taskId)).toEqual(["air", "wet"]);
  });

  it("adds the wiki's required items the quest data lacks, and attaches the wiki's note to ones it has", async () => {
    const guide = guideWith([
      { name: "26x75mm flare cartridge (Red)", amount: "1", note: "Required; Must be fired into the sky at the old sawmill." },
      { name: "ZiD SP-81 26x75 signal pistol", amount: "1", note: "Required; Used to fire the flare cartridge." },
      { name: "Chef's diary", amount: "1", note: "Handover item; must be found in raid; Only found while the quest is active." },
    ]);

    const response = await buildBringResponse(setUp(["air"], { getQuestGuide: async () => guide }));

    expect(response.quests[0].items).toEqual([
      { text: "26x75mm flare cartridge (Red)", note: "Must be fired into the sky at the old sawmill." },
      { text: "ZiD SP-81 26x75 signal pistol", note: "Used to fire the flare cartridge." },
    ]);
  });

  it("falls back to the quest data when the wiki can't be reached, or has no page", async () => {
    const down = await buildBringResponse(
      setUp(["air"], {
        getQuestGuide: async () => {
          throw new Error("offline");
        },
      })
    );
    const missing = await buildBringResponse(setUp(["air"], { getQuestGuide: async () => ({ wikiUrl: "x", found: false, sections: [], rewards: [] }) }));

    expect(down.quests[0].items).toEqual([{ text: "26x75mm flare cartridge (Red)", note: null }]);
    expect(missing.quests[0].items).toEqual(down.quests[0].items);
  });

  it("uses the wiki alone for a quest the quest data says needs nothing", async () => {
    const guide = guideWith([{ name: "Some key", amount: "2", note: "Required*; Opens a door" }]);

    const response = await buildBringResponse(setUp(["plain"], { getQuestGuide: async () => guide }));

    expect(response.quests[0].items).toEqual([{ text: "2× Some key", note: "Opens a door" }]);
  });

  it("describes weapon and gear requirements", async () => {
    const gear = task("gear", "Gear Quest", [
      { bring: [{ kind: "weapon", names: ["M4A1"], count: 1 }, { kind: "gear", names: ["6B43", "6B13"], count: 1 }] },
    ]);
    const deps = setUp(["gear"], { getTasks: () => [gear] });

    expect((await buildBringResponse(deps)).quests[0].items.map((i) => i.text)).toEqual(["Use weapon: M4A1", "Wear: 6B43 or 6B13"]);
  });
});
