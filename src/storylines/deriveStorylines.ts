import type { TarkovTask } from "../tarkovData/types.js";

export interface Storyline {
  id: string;
  name: string;
  taskIds: string[];
  /** "chain" = a run of "<Name> - Part N" quests; absent for the big built-in lines (Kappa, Side Quests, ...). */
  kind?: "chain";
}

// "Chemical - Part 3" -> "Chemical".
const CHAIN_NAME = /^(.*?)\s+-\s+Part\s+\d+/i;

/** Quest runs named "<Name> - Part N" (two or more of them), in the order the quests appear. */
function deriveChains(tasks: TarkovTask[]): Storyline[] {
  const byName = new Map<string, string[]>();
  for (const task of tasks) {
    const name = CHAIN_NAME.exec(task.name)?.[1].trim();
    if (name) {
      byName.set(name, [...(byName.get(name) ?? []), task.id]);
    }
  }
  return [...byName]
    .filter(([, taskIds]) => taskIds.length >= 2)
    .map(([name, taskIds]) => ({ id: `chain:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name, taskIds, kind: "chain" as const }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function isMainStoryFaction(factionName: string | null): boolean {
  // tarkov.dev's real sentinel for "not faction-locked" is the literal
  // string "Any" (verified against the-hideout/tarkov-data-manager's
  // update-quests.mjs, which defaults every task's factionName to "Any").
  // null/undefined is kept as a defensive fallback only.
  return factionName === "Any" || factionName == null;
}

export function deriveStorylines(tasks: TarkovTask[]): Storyline[] {
  const storylines: Storyline[] = [
    { id: "kappa", name: "Path to Kappa", taskIds: tasks.filter((t) => t.kappaRequired).map((t) => t.id) },
    {
      id: "lightkeeper",
      name: "Lightkeeper",
      taskIds: tasks.filter((t) => t.lightkeeperRequired).map((t) => t.id),
    },
    {
      id: "side-quests",
      name: "Side Quests",
      taskIds: tasks.filter((t) => isMainStoryFaction(t.factionName)).map((t) => t.id),
    },
    { id: "usec", name: "USEC", taskIds: tasks.filter((t) => t.factionName === "USEC").map((t) => t.id) },
    { id: "bear", name: "BEAR", taskIds: tasks.filter((t) => t.factionName === "BEAR").map((t) => t.id) },
    ...deriveChains(tasks),
  ];

  return storylines.filter((storyline) => storyline.taskIds.length > 0);
}
