import type { TarkovTask } from "../tarkovData/types.js";

export interface Storyline {
  id: string;
  name: string;
  taskIds: string[];
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
      id: "main-story",
      name: "Main Story",
      taskIds: tasks.filter((t) => !t.factionName).map((t) => t.id),
    },
    { id: "usec", name: "USEC", taskIds: tasks.filter((t) => t.factionName === "USEC").map((t) => t.id) },
    { id: "bear", name: "BEAR", taskIds: tasks.filter((t) => t.factionName === "BEAR").map((t) => t.id) },
  ];

  return storylines.filter((storyline) => storyline.taskIds.length > 0);
}
