import { describe, it, expect, afterEach } from "vitest";
import { ProgressStore } from "../progress/store.js";
import { readPins, setPinned } from "./pinsApi.js";
import type { PinsApiDeps } from "./pinsApi.js";
import { buildTasksResponse } from "./apiData.js";
import { HttpError } from "./createServer.js";
import { deriveStorylines } from "../storylines/deriveStorylines.js";
import { sampleTasks } from "../tarkovData/__fixtures__/sampleTasks.js";

let store: ProgressStore | undefined;
afterEach(() => {
  store?.close();
  store = undefined;
});

function setUp(): PinsApiDeps {
  store = new ProgressStore(":memory:");
  return { store, getTasks: () => sampleTasks };
}

describe("setPinned", () => {
  it("pins and unpins a quest", () => {
    const deps = setUp();

    expect(setPinned(deps, "sample-1", true)).toEqual({ pinned: ["sample-1"] });
    expect(readPins(deps.store)).toEqual(["sample-1"]);

    expect(setPinned(deps, "sample-1", false)).toEqual({ pinned: [] });
    expect(readPins(deps.store)).toEqual([]);
  });

  it("pinning twice doesn't duplicate, and pins keep the order they were made in", () => {
    const deps = setUp();

    setPinned(deps, "sample-2", true);
    setPinned(deps, "sample-1", true);
    setPinned(deps, "sample-2", true);

    expect(readPins(deps.store)).toEqual(["sample-2", "sample-1"]);
  });

  it("rejects pinning a quest that doesn't exist with a 404", () => {
    const deps = setUp();

    expect(() => setPinned(deps, "nope", true)).toThrow(HttpError);
    expect(() => setPinned(deps, null, true)).toThrow(/Unknown quest/);
    expect(readPins(deps.store)).toEqual([]);
  });

  it("lets a quest that no longer exists be unpinned", () => {
    const deps = setUp();
    deps.store.setMeta("pinnedTasks", JSON.stringify(["gone"]));

    expect(setPinned(deps, "gone", false)).toEqual({ pinned: [] });
  });

  it("survives a corrupted saved value by starting with no pins", () => {
    const deps = setUp();
    deps.store.setMeta("pinnedTasks", "{not json");
    expect(readPins(deps.store)).toEqual([]);

    deps.store.setMeta("pinnedTasks", JSON.stringify({ not: "a list" }));
    expect(readPins(deps.store)).toEqual([]);

    deps.store.setMeta("pinnedTasks", JSON.stringify(["ok", 5, null]));
    expect(readPins(deps.store)).toEqual(["ok"]);
  });

  it("is cleared when the player resets their character", () => {
    const deps = setUp();
    setPinned(deps, "sample-1", true);

    deps.store.resetProgress(new Date());

    expect(readPins(deps.store)).toEqual([]);
  });
});

describe("pins in the task list", () => {
  it("marks pinned quests", () => {
    const deps = setUp();
    setPinned(deps, "sample-1", true);

    const response = buildTasksResponse(sampleTasks, deriveStorylines(sampleTasks), deps.store);

    expect(response.tasks.filter((t) => t.pinned).map((t) => t.id)).toEqual(["sample-1"]);
  });
});
