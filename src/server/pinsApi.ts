import { HttpError } from "./createServer.js";
import { PINNED_TASKS_META_KEY } from "../progress/store.js";
import type { ProgressStore } from "../progress/store.js";
import type { TarkovTask } from "../tarkovData/types.js";

export interface PinsApiDeps {
  store: ProgressStore;
  getTasks: () => TarkovTask[];
}

export interface PinsResponse {
  pinned: string[];
}

// Pinning is for "the few I'm working on"; this only stops a runaway client.
const MAX_PINS = 100;

/**
 * The quests the player pinned in the dashboard. The game doesn't write its
 * own pins to any log, so the tracker keeps its own.
 */
export function readPins(store: ProgressStore): string[] {
  const raw = store.getMeta(PINNED_TASKS_META_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function setPinned(deps: PinsApiDeps, taskId: string | null, pinned: boolean): PinsResponse {
  const current = readPins(deps.store);

  if (!pinned) {
    // Unpinning something that isn't pinned is fine; nothing to validate.
    const next = current.filter((id) => id !== taskId);
    deps.store.setMeta(PINNED_TASKS_META_KEY, JSON.stringify(next));
    return { pinned: next };
  }

  if (!taskId || !deps.getTasks().some((task) => task.id === taskId)) {
    throw new HttpError(404, `Unknown quest "${taskId ?? ""}"`);
  }
  if (current.includes(taskId)) {
    return { pinned: current };
  }
  if (current.length >= MAX_PINS) {
    throw new HttpError(400, `You can pin up to ${MAX_PINS} quests`);
  }
  const next = [...current, taskId];
  deps.store.setMeta(PINNED_TASKS_META_KEY, JSON.stringify(next));
  return { pinned: next };
}
