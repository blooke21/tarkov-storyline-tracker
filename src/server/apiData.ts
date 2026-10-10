import type { TarkovTask } from "../tarkovData/types.js";
import type { TaskCache } from "../tarkovData/cache.js";
import type { Storyline } from "../storylines/deriveStorylines.js";
import type { ProgressStore, TaskStatus } from "../progress/store.js";

export interface StatusResponse {
  taskGraphFetchedAt: string | null;
  lastRaidSeenAt: string | null;
  lastWatcherPollAt: string | null;
  /** Set when the player has reset their tracked progress; events before it are ignored. */
  progressSince: string | null;
}

export function buildStatusResponse(cache: TaskCache | null, store: ProgressStore): StatusResponse {
  return {
    taskGraphFetchedAt: cache?.fetchedAt ?? null,
    lastRaidSeenAt: store.getMeta("lastRaidSeenAt"),
    lastWatcherPollAt: store.getMeta("lastWatcherPollAt"),
    progressSince: store.getProgressSince()?.toISOString() ?? null,
  };
}

export interface StorylineProgress {
  id: string;
  name: string;
  totalTasks: number;
  completedTasks: number;
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
    storylines: storylines.map((storyline) => ({
      id: storyline.id,
      name: storyline.name,
      totalTasks: storyline.taskIds.length,
      completedTasks: storyline.taskIds.filter((id) => statuses.get(id) === "completed").length,
    })),
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
      objectives: task.objectives.map((objective) => ({
        description: objective.description,
        optional: objective.optional,
      })),
      storylineIds: storylinesByTaskId.get(task.id) ?? [],
    }));

  return { tasks: items };
}
