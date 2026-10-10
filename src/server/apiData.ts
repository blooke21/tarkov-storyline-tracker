import type { TarkovTask } from "../tarkovData/types.js";
import type { TaskCache } from "../tarkovData/cache.js";
import type { Storyline } from "../storylines/deriveStorylines.js";
import type { ProgressStore, TaskStatus } from "../progress/store.js";
import { readPins } from "./pinsApi.js";

export interface StatusResponse {
  taskGraphFetchedAt: string | null;
  lastRaidSeenAt: string | null;
  lastWatcherPollAt: string | null;
  /** Set when the player has reset their tracked progress; events before it are ignored. */
  progressSince: string | null;
  /** Where the game's logs are being read from, and whether that folder exists. Null if the app wasn't told. */
  logsFolder: LogsFolderInfo | null;
}

export interface LogsFolderInfo {
  path: string;
  found: boolean;
  /** How the folder was found ("BSG Launcher", "settings.json", ...). */
  source: string;
  /** Folders that were checked, shown when nothing was found. */
  tried: string[];
  /** The file the player can create to tell the tracker where the logs are. */
  settingsFile: string;
}

export function buildStatusResponse(cache: TaskCache | null, store: ProgressStore, logsFolder: LogsFolderInfo | null = null): StatusResponse {
  return {
    taskGraphFetchedAt: cache?.fetchedAt ?? null,
    lastRaidSeenAt: store.getMeta("lastRaidSeenAt"),
    lastWatcherPollAt: store.getMeta("lastWatcherPollAt"),
    progressSince: store.getProgressSince()?.toISOString() ?? null,
    logsFolder,
  };
}

export interface StorylineProgress {
  id: string;
  name: string;
  totalTasks: number;
  completedTasks: number;
  kind: "chain" | null;
  /** The player has started this line: something in it is accepted, or some of it is done but not all. */
  inProgress: boolean;
}

export interface ProgressResponse {
  overall: { totalTasks: number; completedTasks: number };
  storylines: StorylineProgress[];
}

export function buildProgressResponse(
  tasks: TarkovTask[],
  storylines: Storyline[],
  store: ProgressStore
): ProgressResponse {
  const statuses = store.getAllStatuses();
  return {
    overall: {
      totalTasks: tasks.length,
      completedTasks: tasks.filter((task) => statuses.get(task.id) === "completed").length,
    },
    storylines: storylines.map((storyline) => {
      const completedTasks = storyline.taskIds.filter((id) => statuses.get(id) === "completed").length;
      const totalTasks = storyline.taskIds.length;
      const hasAccepted = storyline.taskIds.some((id) => statuses.get(id) === "accepted");
      return {
        id: storyline.id,
        name: storyline.name,
        totalTasks,
        completedTasks,
        kind: storyline.kind ?? null,
        inProgress: hasAccepted || (completedTasks > 0 && completedTasks < totalTasks),
      };
    }),
  };
}

export interface TaskResponseItem {
  id: string;
  name: string;
  trader: string;
  map: string | null;
  wikiLink: string | null;
  status: TaskStatus | null;
  actionable: boolean;
  /** The player pinned this quest in the dashboard. */
  pinned: boolean;
  objectives: Array<{ description: string; optional: boolean }>;
  storylineIds: string[];
}

export interface TasksResponse {
  tasks: TaskResponseItem[];
}

export interface TasksFilter {
  storyline?: string;
  trader?: string;
  map?: string;
}

function isActionable(task: TarkovTask, statuses: Map<string, TaskStatus>): boolean {
  if (statuses.get(task.id) === "completed") {
    return false;
  }
  return task.taskRequirements.every((requirement) => {
    if (!requirement.status.includes("complete")) {
      return true;
    }
    return statuses.get(requirement.task.id) === "completed";
  });
}

export function buildTasksResponse(
  tasks: TarkovTask[],
  storylines: Storyline[],
  store: ProgressStore,
  filter: TasksFilter = {}
): TasksResponse {
  const statuses = store.getAllStatuses();
  const pins = new Set(readPins(store));
  const storylinesByTaskId = new Map<string, string[]>();
  for (const storyline of storylines) {
    for (const taskId of storyline.taskIds) {
      const list = storylinesByTaskId.get(taskId) ?? [];
      list.push(storyline.id);
      storylinesByTaskId.set(taskId, list);
    }
  }

  const items = tasks
    .filter((task) => !filter.trader || task.trader.name === filter.trader)
    .filter((task) => !filter.map || task.map?.name === filter.map)
    .filter((task) => !filter.storyline || (storylinesByTaskId.get(task.id) ?? []).includes(filter.storyline))
    .map((task) => ({
      id: task.id,
      name: task.name,
      trader: task.trader.name,
      map: task.map?.name ?? null,
      wikiLink: task.wikiLink,
      status: statuses.get(task.id) ?? null,
      actionable: isActionable(task, statuses),
      pinned: pins.has(task.id),
      objectives: task.objectives.map((objective) => ({
        description: objective.description,
        optional: objective.optional,
      })),
      storylineIds: storylinesByTaskId.get(task.id) ?? [],
    }));

  return { tasks: items };
}
