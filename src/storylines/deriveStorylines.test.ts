import { describe, it, expect } from "vitest";
import { deriveStorylines } from "./deriveStorylines.js";
import { sampleTasks } from "../tarkovData/__fixtures__/sampleTasks.js";
import type { TarkovTask } from "../tarkovData/types.js";

function makeTask(overrides: Partial<TarkovTask> & { id: string }): TarkovTask {
  return {
    name: `Task ${overrides.id}`,
    trader: { id: "t1", name: "Prapor" },
    map: null,
    wikiLink: null,
    kappaRequired: false,
    lightkeeperRequired: false,
    factionName: "Any",
    minPlayerLevel: null,
    objectives: [],
    taskRequirements: [],
    ...overrides,
  };
}

describe("deriveStorylines", () => {
  it("groups kappa-required tasks into a Path to Kappa storyline", () => {
    const tasks = [makeTask({ id: "1", kappaRequired: true }), makeTask({ id: "2", kappaRequired: false })];
    const storylines = deriveStorylines(tasks);
    const kappa = storylines.find((s) => s.id === "kappa");
    expect(kappa?.taskIds).toEqual(["1"]);
  });

  it("groups lightkeeper-required tasks into a Lightkeeper storyline", () => {
    const tasks = [makeTask({ id: "1", lightkeeperRequired: true })];
    const storylines = deriveStorylines(tasks);
    const lightkeeper = storylines.find((s) => s.id === "lightkeeper");
    expect(lightkeeper?.taskIds).toEqual(["1"]);
  });

  it("groups tasks with the real API's 'Any' faction sentinel into Side Quests, not USEC/BEAR", () => {
    const tasks = [
      makeTask({ id: "1", factionName: "USEC" }),
      makeTask({ id: "2", factionName: "BEAR" }),
      makeTask({ id: "3", factionName: "Any" }),
    ];
    const storylines = deriveStorylines(tasks);
    expect(storylines.find((s) => s.id === "usec")?.taskIds).toEqual(["1"]);
    expect(storylines.find((s) => s.id === "bear")?.taskIds).toEqual(["2"]);
    expect(storylines.find((s) => s.id === "side-quests")?.taskIds).toEqual(["3"]);
  });

  it("treats a null factionName as Side Quests too, as a defensive fallback", () => {
    const tasks = [makeTask({ id: "1", factionName: null })];
    const storylines = deriveStorylines(tasks);
    expect(storylines.find((s) => s.id === "side-quests")?.taskIds).toEqual(["1"]);
  });

  it("allows a task to appear in more than one storyline", () => {
    const tasks = [makeTask({ id: "1", kappaRequired: true, factionName: "USEC" })];
    const storylines = deriveStorylines(tasks);
    expect(storylines.find((s) => s.id === "kappa")?.taskIds).toContain("1");
    expect(storylines.find((s) => s.id === "usec")?.taskIds).toContain("1");
  });

  it("omits storylines with no matching tasks", () => {
    const tasks = [makeTask({ id: "1" })];
    const storylines = deriveStorylines(tasks);
    expect(storylines.find((s) => s.id === "lightkeeper")).toBeUndefined();
    expect(storylines.find((s) => s.id === "usec")).toBeUndefined();
    expect(storylines.find((s) => s.id === "bear")).toBeUndefined();
  });

  it("places every task in the real-data-shaped fixture into at least one storyline", () => {
    const storylines = deriveStorylines(sampleTasks);
    const coveredIds = new Set(storylines.flatMap((s) => s.taskIds));
    const uncovered = sampleTasks.filter((t) => !coveredIds.has(t.id));
    expect(uncovered).toEqual([]);
  });

  describe("quest chains", () => {
    const named = (id: string, name: string) => makeTask({ id, name });

    it("groups quests named '<Name> - Part N' into a chain of that name", () => {
      const tasks = [
        named("1", "Chemical - Part 1"),
        named("2", "Chemical - Part 2"),
        named("3", "Spa Tour - Part 1"),
        named("4", "Spa Tour - Part 2"),
        named("5", "Unrelated"),
      ];

      const chains = deriveStorylines(tasks).filter((s) => s.kind === "chain");

      expect(chains.map((c) => [c.id, c.name, c.taskIds])).toEqual([
        ["chain:chemical", "Chemical", ["1", "2"]],
        ["chain:spa-tour", "Spa Tour", ["3", "4"]],
      ]);
    });

    it("ignores a lone '- Part 1' with no sibling, and quests that merely contain 'Part' elsewhere", () => {
      const tasks = [named("1", "Solo - Part 1"), named("2", "Part Time Job"), named("3", "Counterpart")];

      expect(deriveStorylines(tasks).filter((s) => s.kind === "chain")).toEqual([]);
    });
  });
});
