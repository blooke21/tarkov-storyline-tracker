import type { TarkovTask } from "../tarkovData/types.js";
import { GAME_MODES, GAME_MODE_LABELS, type GameMode } from "../tarkovData/gameMode.js";
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
  /** Which mode's quest list the tracker is showing. */
  gameMode: GameMode | null;
  /** The modes the player can switch between. */
  availableModes: Array<{ id: GameMode; label: string }>;
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

export function buildStatusResponse(
  cache: TaskCache | null,
  store: ProgressStore,
  logsFolder: LogsFolderInfo | null = null,
  gameMode: GameMode | null = null
): StatusResponse {
  return {
    taskGraphFetchedAt: cache?.fetchedAt ?? null,
    lastRaidSeenAt: store.getMeta("lastRaidSeenAt"),
    lastWatcherPollAt: store.getMeta("lastWatcherPollAt"),
    progressSince: store.getProgressSince()?.toISOString() ?? null,
    logsFolder,
    gameMode,
    availableModes: GAME_MODES.map((id) => ({ id, label: GAME_MODE_LABELS[id] })),
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
  /** Quests in this line that were failed (a failed quest can't be redone, and it can block the quests after it). */
  failedTasks: number;
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
        failedTasks: storyline.taskIds.filter((id) => statuses.get(id) === "failed").length,
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
  /** A quest it needs completed was failed, so it can't be done any more. */
  blocked: boolean;
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

/**
 * Whether the earlier quest is in a state the requirement accepts. The feed lists the accepted states
 * ("complete", "active", "failed"); "active" counts once the quest is started, and stays true after it's finished.
 */
function requirementMet(requirement: TarkovTask["taskRequirements"][number], statuses: Map<string, TaskStatus>): boolean {
  const status = statuses.get(requirement.task.id);
  const wanted = requirement.status;
  if (wanted.length === 0) {
    return true;
  }
  return (
    (wanted.includes("complete") && status === "completed") ||
    (wanted.includes("active") && (status === "accepted" || status === "completed")) ||
    (wanted.includes("failed") && status === "failed")
  );
}

// A failed quest can't be redone, so it is never "next up"; neither is one that is already finished.
function isActionable(task: TarkovTask, statuses: Map<string, TaskStatus>): boolean {
  const status = statuses.get(task.id);
  if (status === "completed" || status === "failed") {
    return false;
  }
  return task.taskRequirements.every((requirement) => requirementMet(requirement, statuses));
}

/** A quest that can no longer be started because a quest it needs completed was failed instead. */
function isBlocked(task: TarkovTask, statuses: Map<string, TaskStatus>): boolean {
  const status = statuses.get(task.id);
  if (status === "completed" || status === "accepted" || status === "failed") {
    return false;
  }
  return task.taskRequirements.some(
    (requirement) => statuses.get(requirement.task.id) === "failed" && !requirement.status.includes("failed")
  );
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
      blocked: isBlocked(task, statuses),
      pinned: pins.has(task.id),
      objectives: task.objectives.map((objective) => ({
        description: objective.description,
        optional: objective.optional,
      })),
      storylineIds: storylinesByTaskId.get(task.id) ?? [],
    }));

  return { tasks: items };
}
