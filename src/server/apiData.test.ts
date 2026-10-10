import { describe, it, expect, afterEach } from "vitest";
import { ProgressStore } from "../progress/store.js";
import { deriveStorylines } from "../storylines/deriveStorylines.js";
import { sampleTasks } from "../tarkovData/__fixtures__/sampleTasks.js";
import { buildStatusResponse, buildProgressResponse, buildTasksResponse } from "./apiData.js";
import type { TaskCache } from "../tarkovData/cache.js";

let store: ProgressStore | undefined;

afterEach(() => {
  store?.close();
  store = undefined;
});

describe("buildStatusResponse", () => {
  it("defaults every field to null when nothing has been set", () => {
    store = new ProgressStore(":memory:");
    expect(buildStatusResponse(null, store)).toEqual({
      taskGraphFetchedAt: null,
      lastRaidSeenAt: null,
      lastWatcherPollAt: null,
      progressSince: null,
    });
  });

  it("returns the cache's fetchedAt and the store's meta values when set", () => {
    store = new ProgressStore(":memory:");
    store.setMeta("lastRaidSeenAt", "2026-01-01T00:00:00.000Z");
    store.setMeta("lastWatcherPollAt", "2026-01-02T00:00:00.000Z");
    const cache: TaskCache = { version: 2, gameMode: "pve", fetchedAt: "2026-01-03T00:00:00.000Z", tasks: [] };

    expect(buildStatusResponse(cache, store)).toEqual({
      taskGraphFetchedAt: "2026-01-03T00:00:00.000Z",
      lastRaidSeenAt: "2026-01-01T00:00:00.000Z",
      lastWatcherPollAt: "2026-01-02T00:00:00.000Z",
      progressSince: null,
    });
  });

  it("reports when tracking was last reset to", () => {
    store = new ProgressStore(":memory:");
    store.resetProgress(new Date("2026-10-10T15:12:00.000Z"));

    expect(buildStatusResponse(null, store).progressSince).toBe("2026-10-10T15:12:00.000Z");
  });
});

describe("buildProgressResponse", () => {
  it("computes total and completed task counts per storyline", () => {
    store = new ProgressStore(":memory:");
    store.recordEvent("sample-1", "completed");
    const storylines = deriveStorylines(sampleTasks);

    const response = buildProgressResponse(sampleTasks, storylines, store);

    const kappa = response.storylines.find((s) => s.id === "kappa");
    expect(kappa).toEqual({ id: "kappa", name: "Path to Kappa", totalTasks: 2, completedTasks: 1 });
  });

  it("computes overall progress from the full task list, not summed from storylines", () => {
    store = new ProgressStore(":memory:");
    store.recordEvent("sample-1", "completed");
    store.recordEvent("sample-3", "completed");
    const storylines = deriveStorylines(sampleTasks);

    const response = buildProgressResponse(sampleTasks, storylines, store);

    // sampleTasks has 4 tasks total; sample-1 and sample-3 are both
    // kappa-required (they'd double-count if overall were summed from
    // storylines instead of computed from the task list directly).
    expect(response.overall).toEqual({ totalTasks: 4, completedTasks: 2 });
  });
});

describe("buildTasksResponse", () => {
  it("returns every task with status, storyline membership, and objectives when no filter is given", () => {
    store = new ProgressStore(":memory:");
    const storylines = deriveStorylines(sampleTasks);

    const response = buildTasksResponse(sampleTasks, storylines, store);

    expect(response.tasks).toHaveLength(4);
    const sample1 = response.tasks.find((t) => t.id === "sample-1");
    expect(sample1?.status).toBeNull();
    expect(sample1?.wikiLink).toBe("https://escapefromtarkov.fandom.com/wiki/Debut");
    expect(sample1?.objectives).toEqual([
      { description: "Successfully extract from the location", optional: false },
    ]);
    expect(sample1?.storylineIds).toContain("kappa");
  });

  it("marks a task not actionable while its prerequisite is incomplete", () => {
    store = new ProgressStore(":memory:");
    const storylines = deriveStorylines(sampleTasks);

    const response = buildTasksResponse(sampleTasks, storylines, store);

    const sample2 = response.tasks.find((t) => t.id === "sample-2");
    expect(sample2?.actionable).toBe(false);
  });

  it("marks a task actionable once its prerequisite is completed", () => {
    store = new ProgressStore(":memory:");
    store.recordEvent("sample-1", "completed");
    const storylines = deriveStorylines(sampleTasks);

    const response = buildTasksResponse(sampleTasks, storylines, store);

    const sample2 = response.tasks.find((t) => t.id === "sample-2");
    expect(sample2?.actionable).toBe(true);
  });

  it("never marks an already-completed task as actionable", () => {
    store = new ProgressStore(":memory:");
    store.recordEvent("sample-1", "completed");
    const storylines = deriveStorylines(sampleTasks);

    const response = buildTasksResponse(sampleTasks, storylines, store);

    const sample1 = response.tasks.find((t) => t.id === "sample-1");
    expect(sample1?.actionable).toBe(false);
  });

  it("filters by trader", () => {
    store = new ProgressStore(":memory:");
    const storylines = deriveStorylines(sampleTasks);

    const response = buildTasksResponse(sampleTasks, storylines, store, { trader: "Prapor" });

    expect(response.tasks.map((t) => t.id).sort()).toEqual(["sample-1", "sample-3"]);
  });

  it("filters by map", () => {
    store = new ProgressStore(":memory:");
    const storylines = deriveStorylines(sampleTasks);

    const response = buildTasksResponse(sampleTasks, storylines, store, { map: "Customs" });

    expect(response.tasks.map((t) => t.id)).toEqual(["sample-3"]);
  });

  it("filters by storyline", () => {
    store = new ProgressStore(":memory:");
    const storylines = deriveStorylines(sampleTasks);

    const response = buildTasksResponse(sampleTasks, storylines, store, { storyline: "bear" });

    expect(response.tasks.map((t) => t.id)).toEqual(["sample-4"]);
  });

  it("combines filters", () => {
    store = new ProgressStore(":memory:");
    const storylines = deriveStorylines(sampleTasks);

    const response = buildTasksResponse(sampleTasks, storylines, store, { storyline: "kappa", trader: "Prapor" });

    expect(response.tasks.map((t) => t.id).sort()).toEqual(["sample-1", "sample-3"]);
  });
});
