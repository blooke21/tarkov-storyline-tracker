import { describe, it, expect, afterEach } from "vitest";
import { ProgressStore } from "../progress/store.js";
import { buildEndingsResponse } from "./endingsApi.js";
import type { EndingsApiDeps } from "./endingsApi.js";
import { setPinned } from "./pinsApi.js";
import { setChapterStatus } from "./chaptersApi.js";
import { STORY_CHAPTERS } from "../storyChapters/chapters.js";
import { CHAPTER_CHOICES } from "../storyChapters/endings.js";
import { buildTasksResponse } from "./apiData.js";
import type { FailIfTask, TarkovTask } from "../tarkovData/types.js";

function quest(id: string, name: string, failIf: FailIfTask[] = []): TarkovTask {
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
    objectives: [],
    taskRequirements: [],
    failIfTasks: failIf,
  };
}
const completes = (taskId: string): FailIfTask => ({ taskId, status: ["complete"] });

// Chemical - Part 4, Big Customer and Out of Curiosity exclude each other (real quests); Debut has no choice.
const tasks = [
  quest("chem", "Chemical - Part 4", [completes("big"), completes("curious")]),
  quest("big", "Big Customer", [completes("chem"), completes("curious")]),
  quest("curious", "Out of Curiosity", [completes("chem"), completes("big")]),
  quest("debut", "Debut"),
];

let store: ProgressStore | undefined;
afterEach(() => {
  store?.close();
  store = undefined;
});

function setUp(): EndingsApiDeps {
  store = new ProgressStore(":memory:");
  return { store, getTasks: () => tasks, chapterDeps: { store, chapters: STORY_CHAPTERS } };
}

describe("buildEndingsResponse", () => {
  it("warns about accepted quests that exclude others, saying what finishing them fails", () => {
    const deps = setUp();
    deps.store.recordEvent("chem", "accepted");

    const response = buildEndingsResponse(deps);

    expect(response.quests).toHaveLength(1);
    expect(response.quests[0]).toMatchObject({ taskId: "chem", name: "Chemical - Part 4", accepted: true, pinned: false });
    expect(response.quests[0].lines).toEqual([
      "Completing this quest fails Big Customer and Out of Curiosity.",
      "Completing Big Customer or Out of Curiosity fails this quest.",
    ]);
  });

  it("also covers pinned quests, accepted ones first", () => {
    const deps = setUp();
    setPinned({ store: deps.store, getTasks: deps.getTasks }, "big", true);
    deps.store.recordEvent("curious", "accepted");

    expect(buildEndingsResponse(deps).quests.map((q) => [q.name, q.accepted, q.pinned])).toEqual([
      ["Out of Curiosity", true, false],
      ["Big Customer", false, true],
    ]);
  });

  it("says where the player already stands with the alternatives", () => {
    const deps = setUp();
    deps.store.recordEvent("chem", "accepted");
    deps.store.recordEvent("big", "accepted");

    const lines = buildEndingsResponse(deps).quests.find((q) => q.taskId === "chem")!.lines;

    expect(lines[0]).toContain("Big Customer (you've accepted it)");
  });

  it("leaves out quests that aren't accepted or pinned, are finished or failed, or have no choice", () => {
    const deps = setUp();
    deps.store.recordEvent("big", "completed");
    deps.store.recordEvent("curious", "failed");
    deps.store.recordEvent("debut", "accepted");

    expect(buildEndingsResponse(deps).quests).toEqual([]);
  });

  it("warns about story chapters the player is on that have a decision, and not others", () => {
    const deps = setUp();
    setChapterStatus(deps.chapterDeps, "falling-skies", "active");
    setChapterStatus(deps.chapterDeps, "tour", "active"); // has no decision

    const chapters = buildEndingsResponse(deps).chapters;

    expect(chapters.map((c) => c.id)).toEqual(["falling-skies"]);
    expect(chapters[0].choice.options.map((o) => o.label)).toContain("Keep the armored case");
  });

  it("stops warning about a chapter once it's marked done", () => {
    const deps = setUp();
    setChapterStatus(deps.chapterDeps, "the-ticket", "done");

    expect(buildEndingsResponse(deps).chapters).toEqual([]);
  });
});

describe("choices in the quest list", () => {
  it("marks quests with alternatives and describes them, leaving others without", () => {
    store = new ProgressStore(":memory:");

    const list = buildTasksResponse(tasks, [], store).tasks;

    expect(list.find((t) => t.id === "chem")?.endings?.lines[0]).toBe("Completing this quest fails Big Customer and Out of Curiosity.");
    expect(list.find((t) => t.id === "debut")?.endings).toBeNull();
  });
});

describe("the story chapters' choices", () => {
  it("belong to chapters that exist, and every decision has options (except Boreas, whose choices were made earlier)", () => {
    const ids = new Set(STORY_CHAPTERS.map((c) => c.id));
    for (const [id, choice] of Object.entries(CHAPTER_CHOICES)) {
      expect(ids.has(id)).toBe(true);
      expect(choice.summary.length).toBeGreaterThan(20);
      if (id !== "boreas") expect(choice.options.length).toBeGreaterThanOrEqual(2);
    }
    expect(CHAPTER_CHOICES["the-ticket"].options.map((o) => o.label)).toEqual(["Savior ending", "Debtor ending", "Fallen ending", "Survivor ending"]);
  });
});
