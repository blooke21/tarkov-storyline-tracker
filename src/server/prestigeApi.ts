import { HttpError } from "./createServer.js";
import type { ProgressStore } from "../progress/store.js";
import type { PrestigeCondition, PrestigeLevel } from "../prestige/prestigeData.js";
import { wikiRequirements } from "../prestige/wikiRequirements.js";
import type { GameMode } from "../tarkovData/gameMode.js";
import type { TarkovTask } from "../tarkovData/types.js";

export const PRESTIGE_META_KEY = "prestigeProgress";
const WIKI_URL = "https://escapefromtarkov.fandom.com/wiki/Prestige";

export interface PrestigeApiDeps {
  store: ProgressStore;
  getLevels: () => PrestigeLevel[];
  getTasks: () => TarkovTask[];
  /** A story chapter's name and whether the player marked it done, or undefined for an unknown chapter. */
  getChapter?: (chapterId: string) => { name: string; done: boolean } | undefined;
  /** Decides which wiki-only requirements apply (the first PvE prestige has no New Beginning quest). */
  gameMode?: GameMode;
}

export interface PrestigeConditionView {
  id: string;
  text: string;
  done: boolean;
  /** Worked out by the tracker rather than ticked by hand. */
  automatic: boolean;
  /** Where an automatic answer comes from, for display ("your quests"). */
  source: string | null;
  /**
   * Where the requirement leads: a quest in the dashboard's quest list (taskId set), a chapter in the
   * dashboard, or a wiki page for something the dashboard doesn't have (external).
   */
  link: { url: string; external: boolean; taskId?: string } | null;
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

function describe(condition: PrestigeCondition, taskName: (id: string) => string, chapterName: (id: string) => string): string {
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
    case "chapter":
      return `Complete the story chapter "${chapterName(condition.chapterId)}"`;
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
  const getChapter = deps.getChapter ?? (() => undefined);

  let next: PrestigeResponse["next"] = null;
  if (upcoming) {
    const tasksById = new Map(deps.getTasks().map((task) => [task.id, task]));
    const names = new Map([...tasksById].map(([id, task]) => [id, task.name]));
    const statuses = deps.store.getAllStatuses();
    const ticked = new Set(saved.done);
    // The feed's requirements, plus the ones it leaves out (see wikiRequirements.ts).
    const all = [...upcoming.conditions, ...wikiRequirements(upcoming.level, deps.gameMode ?? "pve")];
    const conditions = all.map((condition): PrestigeConditionView => {
      const text = describe(
        condition,
        (id) => names.get(id) ?? "a quest",
        (id) => getChapter(id)?.name ?? "a story chapter"
      );
      if (condition.kind === "task") {
        const listed = tasksById.has(condition.taskId);
        return {
          id: condition.id,
          text,
          automatic: true,
          source: "your quests",
          link: listed ? { url: `#quest/${encodeURIComponent(condition.taskId)}`, external: false, taskId: condition.taskId } : null,
          done: statuses.get(condition.taskId) === "completed",
        };
      }
      if (condition.kind === "chapter") {
        return {
          id: condition.id,
          text,
          automatic: true,
          source: "your Story chapters",
          link: { url: `#chapter/${encodeURIComponent(condition.chapterId)}`, external: false },
          done: getChapter(condition.chapterId)?.done === true,
        };
      }
      const url = condition.kind === "other" ? condition.url : undefined;
      return { id: condition.id, text, automatic: false, source: null, link: url ? { url, external: true } : null, done: ticked.has(condition.id) };
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
