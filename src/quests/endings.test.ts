import { describe, it, expect } from "vitest";
import { computeEndings, describeEndings } from "./endings.js";
import type { FailIfTask, TarkovTask } from "../tarkovData/types.js";
import type { TaskStatus } from "../progress/store.js";

function quest(id: string, extra: Partial<TarkovTask> & { failIf?: FailIfTask[] } = {}): TarkovTask {
  const { failIf, ...rest } = extra;
  return {
    id,
    name: id.toUpperCase(),
    trader: { id: "t", name: "Prapor" },
    map: null,
    wikiLink: null,
    kappaRequired: false,
    lightkeeperRequired: false,
    factionName: "Any",
    minPlayerLevel: null,
    objectives: [],
    taskRequirements: [],
    failIfTasks: failIf ?? [],
    ...rest,
  };
}
const done = (...ids: string[]) => ({ taskId: ids[0], status: ["complete"] });
const statuses = (entries: Array<[string, TaskStatus]> = []) => new Map(entries);

describe("computeEndings", () => {
  it("links quests that exclude each other, from both sides, with the player's current status", () => {
    // Completing B or C fails A; completing A fails B and C.
    const tasks = [
      quest("a", { failIf: [done("b"), done("c")] }),
      quest("b", { failIf: [done("a")] }),
      quest("c", { failIf: [done("a")] }),
    ];

    const endings = computeEndings(tasks, statuses([["b", "accepted"]]));

    expect(endings.get("a")?.failsIfCompleted).toEqual([
      { taskId: "b", name: "B", status: "accepted" },
      { taskId: "c", name: "C", status: null },
    ]);
    expect(endings.get("a")?.failedByCompleting.map((l) => l.taskId)).toEqual(["b", "c"]);
    expect(endings.get("b")?.failsIfCompleted.map((l) => l.taskId)).toEqual(["a"]);
    expect(endings.get("b")?.failedByCompleting.map((l) => l.taskId)).toEqual(["a"]);
  });

  it("handles a one-way rule: finishing X fails Y, but finishing Y doesn't fail X", () => {
    const tasks = [quest("x"), quest("y", { failIf: [done("x")] })];

    const endings = computeEndings(tasks, statuses());

    expect(endings.get("x")).toMatchObject({ failedByCompleting: [{ taskId: "y" }], failsIfCompleted: [] });
    expect(endings.get("y")).toMatchObject({ failsIfCompleted: [{ taskId: "x" }], failedByCompleting: [] });
  });

  it("lists a quest that only opens up if another is failed, as the other way through", () => {
    const tasks = [
      quest("a"),
      quest("route-b", { taskRequirements: [{ task: { id: "a" }, status: ["failed"] }] }),
      // Either outcome of "a" unlocks this one, so it isn't an alternative route.
      quest("either", { taskRequirements: [{ task: { id: "a" }, status: ["complete", "failed"] }] }),
    ];

    const endings = computeEndings(tasks, statuses());

    expect(endings.get("a")?.unlocksIfFailed.map((l) => l.taskId)).toEqual(["route-b"]);
    expect(endings.has("either")).toBe(false);
  });

  it("flags when completing a quest would fail one the Kappa container needs", () => {
    const tasks = [quest("a"), quest("b", { kappaRequired: true, failIf: [done("a")] })];

    const endings = computeEndings(tasks, statuses());

    expect(endings.get("a")?.blocksKappa).toBe(true);
    expect(endings.get("b")?.blocksKappa).toBe(false);
  });

  it("leaves out quests with no alternatives, self references, and quests it doesn't know about", () => {
    const tasks = [quest("plain"), quest("self", { failIf: [done("self")] }), quest("ghost-rule", { failIf: [done("not-in-the-list")] })];

    expect(computeEndings(tasks, statuses()).size).toBe(0);
  });

  it("copes with quests that carry no fail data at all (an older saved copy)", () => {
    const old = { ...quest("a"), failIfTasks: undefined };

    expect(computeEndings([old], statuses()).size).toBe(0);
  });

  it("ignores fail rules that aren't about completing another quest", () => {
    const tasks = [quest("a"), quest("b", { failIf: [{ taskId: "a", status: ["active"] }] })];

    expect(computeEndings(tasks, statuses()).size).toBe(0);
  });
});

describe("describeEndings", () => {
  const tasks = [
    quest("a", { failIf: [done("b")] }),
    quest("b", { failIf: [done("a")] }),
    quest("route", { taskRequirements: [{ task: { id: "a" }, status: ["failed"] }] }),
  ];

  it("looks ahead for a quest that is still open", () => {
    const endings = computeEndings(tasks, statuses([["b", "accepted"]]));

    expect(describeEndings(endings.get("a")!, null)).toEqual([
      "Completing this quest fails B (you've accepted it).",
      "Completing B (you've accepted it) fails this quest.",
      "If you fail this quest, ROUTE opens up instead.",
    ]);
  });

  it("says what happened for a quest that failed because an alternative was completed", () => {
    const endings = computeEndings(tasks, statuses([["a", "failed"], ["b", "completed"]]));

    expect(describeEndings(endings.get("a")!, "failed")).toEqual(["Failed because you completed B.", "Failing it opened up ROUTE."]);
  });

  it("says what a completed quest cost", () => {
    const endings = computeEndings(tasks, statuses([["b", "completed"], ["a", "failed"]]));

    expect(describeEndings(endings.get("b")!, "completed")).toEqual(["Completing it failed A."]);
  });
});
