import { describe, it, expect, afterEach } from "vitest";
import { ProgressStore } from "../progress/store.js";
import { buildChaptersResponse, setChapterPosition, setChapterStatus, setObjectiveDone } from "./chaptersApi.js";
import type { ChaptersApiDeps } from "./chaptersApi.js";
import { HttpError } from "./createServer.js";
import { STORY_CHAPTERS } from "../storyChapters/chapters.js";
import type { StoryChapter } from "../storyChapters/types.js";

const chapters: StoryChapter[] = [
  {
    id: "demo",
    name: "Demo",
    wikiUrl: "https://example.test/Demo",
    unlock: "Talk to someone",
    objectives: [
      { depth: 1, optional: false, text: "Step one" }, // 0
      { depth: 2, optional: false, text: "Sub a" }, // 1
      { depth: 2, optional: true, text: "Sub b (optional)" }, // 2
      { depth: 1, optional: false, text: "Step two" }, // 3
      { depth: 1, optional: true, text: "Bonus step" }, // 4
    ],
  },
  { id: "other", name: "Other", wikiUrl: "https://example.test/Other", unlock: "", objectives: [{ depth: 1, optional: false, text: "x" }] },
];

let store: ProgressStore | undefined;
afterEach(() => {
  store?.close();
  store = undefined;
});

function setUp(): ChaptersApiDeps {
  store = new ProgressStore(":memory:");
  return { store, chapters };
}

const demo = (deps: ChaptersApiDeps) => buildChaptersResponse(deps).chapters.find((c) => c.id === "demo")!;

describe("buildChaptersResponse", () => {
  it("starts every chapter not-started, pointing at the first required main step", () => {
    const deps = setUp();

    const view = demo(deps);

    expect(view.status).toBe("not-started");
    expect(view.currentIndex).toBe(0);
    expect(view.totalSteps).toBe(2); // the optional bonus step doesn't count
    expect(view.doneSteps).toBe(0);
    expect(view.objectives.every((o) => !o.done)).toBe(true);
  });
});

describe("setObjectiveDone", () => {
  it("ticking a main step also ticks its sub-steps, makes the chapter active, and moves on to the next step", () => {
    const deps = setUp();

    setObjectiveDone(deps, "demo", "0", true);

    const view = demo(deps);
    expect(view.objectives.map((o) => o.done)).toEqual([true, true, true, false, false]);
    expect(view.status).toBe("active");
    expect(view.currentIndex).toBe(3);
    expect(view.doneSteps).toBe(1);
  });

  it("ticking a sub-step leaves its parent alone", () => {
    const deps = setUp();

    setObjectiveDone(deps, "demo", "1", true);

    expect(demo(deps).objectives.map((o) => o.done)).toEqual([false, true, false, false, false]);
    expect(demo(deps).currentIndex).toBe(0);
  });

  it("can untick a step again", () => {
    const deps = setUp();
    setObjectiveDone(deps, "demo", "0", true);

    setObjectiveDone(deps, "demo", "0", false);

    expect(demo(deps).objectives.every((o) => !o.done)).toBe(true);
  });

  it("has no next step once every required main step is ticked", () => {
    const deps = setUp();
    setObjectiveDone(deps, "demo", "0", true);
    setObjectiveDone(deps, "demo", "3", true);

    expect(demo(deps).currentIndex).toBeNull();
    expect(demo(deps).doneSteps).toBe(2);
  });

  it("keeps chapters separate", () => {
    const deps = setUp();
    setObjectiveDone(deps, "demo", "0", true);

    expect(buildChaptersResponse(deps).chapters.find((c) => c.id === "other")?.status).toBe("not-started");
  });

  it("rejects an unknown chapter with 404 and a bad index with 400", () => {
    const deps = setUp();

    expect(() => setObjectiveDone(deps, "nope", "0", true)).toThrow(HttpError);
    for (const bad of [null, "abc", "-1", "5", "1.5"]) {
      expect(() => setObjectiveDone(deps, "demo", bad, true)).toThrow(/index/);
    }
    try {
      setObjectiveDone(deps, "nope", "0", true);
    } catch (error) {
      expect((error as HttpError).status).toBe(404);
    }
  });
});

describe("setChapterPosition", () => {
  it("ticks everything before the chosen step and makes the chapter active, with that step next", () => {
    const deps = setUp();

    setChapterPosition(deps, "demo", "3");

    const view = demo(deps);
    expect(view.objectives.map((o) => o.done)).toEqual([true, true, true, false, false]);
    expect(view.status).toBe("active");
    expect(view.currentIndex).toBe(3);
  });

  it("moving back unticks the later steps", () => {
    const deps = setUp();
    setChapterPosition(deps, "demo", "4");

    setChapterPosition(deps, "demo", "0");

    expect(demo(deps).objectives.every((o) => !o.done)).toBe(true);
    expect(demo(deps).status).toBe("active");
  });

  it("rejects an unknown chapter and a bad index", () => {
    const deps = setUp();

    expect(() => setChapterPosition(deps, "nope", "0")).toThrow(HttpError);
    for (const bad of [null, "x", "-1", "5"]) {
      expect(() => setChapterPosition(deps, "demo", bad)).toThrow(/index/);
    }
  });
});

describe("setChapterStatus", () => {
  it("marks a chapter active without ticking anything", () => {
    const deps = setUp();

    setChapterStatus(deps, "demo", "active");

    expect(demo(deps).status).toBe("active");
    expect(demo(deps).doneSteps).toBe(0);
  });

  it("marks a chapter done, and active again after that", () => {
    const deps = setUp();

    setChapterStatus(deps, "demo", "done");
    expect(demo(deps).status).toBe("done");

    setChapterStatus(deps, "demo", "active");
    expect(demo(deps).status).toBe("active");
  });

  it("not-started forgets the ticked steps too", () => {
    const deps = setUp();
    setObjectiveDone(deps, "demo", "0", true);

    setChapterStatus(deps, "demo", "not-started");

    expect(demo(deps).status).toBe("not-started");
    expect(demo(deps).objectives.every((o) => !o.done)).toBe(true);
  });

  it("rejects a status it doesn't know", () => {
    const deps = setUp();

    expect(() => setChapterStatus(deps, "demo", "finished")).toThrow(/status/);
    expect(() => setChapterStatus(deps, "demo", null)).toThrow(/status/);
  });

  it("survives a corrupted saved value by starting fresh", () => {
    const deps = setUp();
    deps.store.setMeta("storyChapterProgress", "{not json");

    expect(demo(deps).status).toBe("not-started");
  });

  it("is cleared when the player resets their character", () => {
    const deps = setUp();
    setObjectiveDone(deps, "demo", "0", true);

    deps.store.resetProgress(new Date());

    expect(demo(deps).status).toBe("not-started");
  });
});

describe("the built-in chapters", () => {
  it("are well-formed: unique ids, a wiki link, and every chapter starts with a main step", () => {
    expect(STORY_CHAPTERS.map((c) => c.name).slice(0, 2)).toEqual(["Tour", "Falling Skies"]);
    expect(new Set(STORY_CHAPTERS.map((c) => c.id)).size).toBe(STORY_CHAPTERS.length);
    for (const chapter of STORY_CHAPTERS) {
      expect(chapter.wikiUrl).toMatch(/^https:\/\/escapefromtarkov\.fandom\.com\/wiki\//);
      expect(chapter.objectives.length).toBeGreaterThan(5);
      expect(chapter.objectives[0].depth).toBe(1);
      expect(chapter.objectives.some((o) => o.depth === 1 && !o.optional)).toBe(true);
      expect(chapter.objectives.every((o) => o.text.length > 0 && !/\[\[|\]\]|''|<|File:/.test(o.text))).toBe(true);
    }
  });
});
