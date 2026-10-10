import { HttpError } from "./createServer.js";
import type { ProgressStore } from "../progress/store.js";
import type { PrestigeCondition, PrestigeLevel } from "../prestige/prestigeData.js";
import type { TarkovTask } from "../tarkovData/types.js";

export const PRESTIGE_META_KEY = "prestigeProgress";
const WIKI_URL = "https://escapefromtarkov.fandom.com/wiki/Prestige";

export interface PrestigeApiDeps {
  store: ProgressStore;
  getLevels: () => PrestigeLevel[];
  getTasks: () => TarkovTask[];
}

export interface PrestigeConditionView {
  id: string;
  text: string;
  done: boolean;
  /** Worked out from the player's quest progress rather than ticked by hand. */
  automatic: boolean;
}

export interface PrestigeResponse {
  /** False when the requirements couldn't be downloaded and there's no saved copy. */
  available: boolean;
  /** The prestige level the player says they're on (the game doesn't log it). */
  current: number;
  maxLevel: number;
  next: { level: number; conditions: PrestigeConditionView[]; doneCount: number; total: number } | null;
  wikiUrl: string;
}

interface Saved {
  level: number;
  /** Ids of the conditions of the next level the player ticked off. */
  done: string[];
}

function readSaved(store: ProgressStore): Saved {
  const raw = store.getMeta(PRESTIGE_META_KEY);
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<Saved>) : {};
    return {
      level: Number.isInteger(parsed.level) && (parsed.level as number) >= 0 ? (parsed.level as number) : 0,
      done: Array.isArray(parsed.done) ? parsed.done.filter((id): id is string => typeof id === "string") : [],
    };
  } catch {
    return { level: 0, done: [] };
  }
}

function describe(condition: PrestigeCondition, taskName: (id: string) => string): string {
  switch (condition.kind) {
    case "playerLevel":
      return `Reach player level ${condition.level}`;
    case "skill":
      return `${condition.skill} skill at level ${condition.level}`;
    case "hideoutStation":
      return `${condition.station} at hideout level ${condition.level}`;
    case "haveItem":
      return `Have ${condition.count.toLocaleString("en-US")} ${condition.item}`;
    case "task":
      return `Complete the quest "${taskName(condition.taskId)}"`;
    case "other":
      return condition.text;
  }
}

export function buildPrestigeResponse(deps: PrestigeApiDeps): PrestigeResponse {
  const levels = deps.getLevels();
  const saved = readSaved(deps.store);
  const maxLevel = levels.length ? Math.max(...levels.map((l) => l.level)) : 0;
  const current = Math.min(saved.level, maxLevel);
  const upcoming = levels.find((l) => l.level === current + 1);

  let next: PrestigeResponse["next"] = null;
  if (upcoming) {
    const names = new Map(deps.getTasks().map((task) => [task.id, task.name]));
    const statuses = deps.store.getAllStatuses();
    const ticked = new Set(saved.done);
    const conditions = upcoming.conditions.map((condition): PrestigeConditionView => {
      const automatic = condition.kind === "task";
      return {
        id: condition.id,
        text: describe(condition, (id) => names.get(id) ?? "a quest"),
        automatic,
        done: condition.kind === "task" ? statuses.get(condition.taskId) === "completed" : ticked.has(condition.id),
      };
    });
    next = { level: upcoming.level, conditions, doneCount: conditions.filter((c) => c.done).length, total: conditions.length };
  }

  return { available: levels.length > 0, current, maxLevel, next, wikiUrl: WIKI_URL };
}

function save(deps: PrestigeApiDeps, saved: Saved): PrestigeResponse {
  deps.store.setMeta(PRESTIGE_META_KEY, JSON.stringify(saved));
  return buildPrestigeResponse(deps);
}

/** Sets the prestige level the player is on. Moving to a new level starts the next level's checklist fresh. */
export function setPrestigeLevel(deps: PrestigeApiDeps, levelParam: string | null): PrestigeResponse {
  const levels = deps.getLevels();
  const maxLevel = levels.length ? Math.max(...levels.map((l) => l.level)) : 0;
  const level = Number(levelParam);
  if (levelParam === null || levelParam === "" || !Number.isInteger(level) || level < 0 || level > maxLevel) {
    throw new HttpError(400, `level must be a whole number from 0 to ${maxLevel}`);
  }
  return save(deps, { level, done: [] });
}

export function setPrestigeCondition(deps: PrestigeApiDeps, conditionId: string | null, done: boolean): PrestigeResponse {
  const current = buildPrestigeResponse(deps);
  const condition = current.next?.conditions.find((candidate) => candidate.id === conditionId);
  if (!condition) {
    throw new HttpError(404, `Unknown prestige requirement "${conditionId ?? ""}"`);
  }
  if (condition.automatic) {
    throw new HttpError(400, "That requirement is checked automatically from your quest progress");
  }
  const saved = readSaved(deps.store);
  const without = saved.done.filter((id) => id !== condition.id);
  return save(deps, { level: current.current, done: done ? [...without, condition.id] : without });
}
