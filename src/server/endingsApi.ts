import type { ProgressStore } from "../progress/store.js";
import type { TarkovTask } from "../tarkovData/types.js";
import { computeEndings, describeEndings } from "../quests/endings.js";
import { buildChaptersResponse } from "./chaptersApi.js";
import type { ChaptersApiDeps } from "./chaptersApi.js";
import type { ChapterChoice } from "../storyChapters/endings.js";
import { readPins } from "./pinsApi.js";

export interface EndingsApiDeps {
  store: ProgressStore;
  getTasks: () => TarkovTask[];
  chapterDeps: ChaptersApiDeps;
}

export interface QuestWarning {
  taskId: string;
  name: string;
  accepted: boolean;
  pinned: boolean;
  lines: string[];
  blocksKappa: boolean;
}

export interface ChapterWarning {
  id: string;
  name: string;
  choice: ChapterChoice;
}

export interface EndingsResponse {
  quests: QuestWarning[];
  chapters: ChapterWarning[];
}

/**
 * The choices worth a warning right now: quests the player has accepted or pinned that exclude others or open an
 * alternate route (finishing the wrong one can't be undone), and story chapters they're on that have a decision.
 */
export function buildEndingsResponse(deps: EndingsApiDeps): EndingsResponse {
  const tasks = deps.getTasks();
  const statuses = deps.store.getAllStatuses();
  const pinned = new Set(readPins(deps.store));
  const endings = computeEndings(tasks, statuses);

  const quests: QuestWarning[] = [];
  for (const task of tasks) {
    const status = statuses.get(task.id);
    const open = status !== "completed" && status !== "failed";
    const choices = endings.get(task.id);
    if (!choices || !open || (status !== "accepted" && !pinned.has(task.id))) {
      continue;
    }
    quests.push({
      taskId: task.id,
      name: task.name,
      accepted: status === "accepted",
      pinned: pinned.has(task.id),
      lines: describeEndings(choices, status ?? null),
      blocksKappa: choices.blocksKappa,
    });
  }
  // Accepted ones first (those are in play), then pinned ones; each group by name.
  quests.sort((a, b) => Number(b.accepted) - Number(a.accepted) || a.name.localeCompare(b.name));

  const chapters: ChapterWarning[] = buildChaptersResponse(deps.chapterDeps)
    .chapters.filter((chapter) => chapter.status === "active" && chapter.choice !== null)
    .map((chapter) => ({ id: chapter.id, name: chapter.name, choice: chapter.choice! }));

  return { quests, chapters };
}
