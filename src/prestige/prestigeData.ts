import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { TARKOV_DEV_JSON_BASE_URL } from "../tarkovData/jsonClient.js";
import { DEFAULT_GAME_MODE, type GameMode } from "../tarkovData/gameMode.js";

export type PrestigeCondition =
  | { id: string; kind: "playerLevel"; level: number }
  | { id: string; kind: "skill"; skill: string; level: number }
  | { id: string; kind: "hideoutStation"; station: string; level: number }
  | { id: string; kind: "haveItem"; item: string; count: number }
  /** Finish a quest — the one kind the tracker can check from the player's quest progress. */
  | { id: string; kind: "task"; taskId: string }
  /** Finish a story chapter — checked from the player's Story chapters section. */
  | { id: string; kind: "chapter"; chapterId: string }
  | { id: string; kind: "other"; text: string; /** A page about it, if there is one. */ url?: string };

export interface PrestigeLevel {
  level: number;
  conditions: PrestigeCondition[];
}

// The raw feed shapes this module reads (only the fields it needs).
interface RawCondition {
  id: string;
  type: string;
  playerLevel?: number;
  skill?: string;
  level?: number;
  station?: string;
  stationLevel?: number;
  count?: number | null;
  items?: string[];
  task?: string;
}
interface RawPrestige {
  prestigeLevel: number;
  conditions: RawCondition[];
}
export interface PrestigeFeeds {
  tasks: { data: { prestige: RawPrestige[] } };
  hideout: { data: Record<string, { name?: string; normalizedName?: string }> };
  hideoutEn: { data: Record<string, string> };
}

// The only item the feed's prestige conditions have asked for so far is money.
// Resolving any other id would need the 1.7 MB item-name file, so it's named generically.
const ITEM_NAMES: Record<string, string> = { "5449016a4bdc2d6f028b456f": "Roubles" };

/** "RecoilControl" -> "Recoil Control". */
function spaced(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function titleCase(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function convertPrestigeFeeds(feeds: PrestigeFeeds): PrestigeLevel[] {
  const stationName = (stationId: string | undefined): string => {
    const station = stationId ? feeds.hideout.data[stationId] : undefined;
    return (station?.name && feeds.hideoutEn.data[station.name]) || (station?.normalizedName ? titleCase(station.normalizedName) : "a hideout station");
  };

  return feeds.tasks.data.prestige
    .map((raw): PrestigeLevel => ({
      level: raw.prestigeLevel,
      conditions: raw.conditions.map((condition): PrestigeCondition => {
        switch (condition.type) {
          case "playerLevel":
            return { id: condition.id, kind: "playerLevel", level: condition.playerLevel ?? condition.count ?? 0 };
          case "skill":
            return { id: condition.id, kind: "skill", skill: spaced(condition.skill ?? "a skill"), level: condition.level ?? 0 };
          case "hideoutStation":
            return {
              id: condition.id,
              kind: "hideoutStation",
              station: stationName(condition.station),
              level: condition.stationLevel ?? condition.count ?? 0,
            };
          case "haveItem":
            return { id: condition.id, kind: "haveItem", item: ITEM_NAMES[condition.items?.[0] ?? ""] ?? "items", count: condition.count ?? 0 };
          case "taskStatus":
            return condition.task
              ? { id: condition.id, kind: "task", taskId: condition.task }
              : { id: condition.id, kind: "other", text: "Finish a quest" };
          default:
            return { id: condition.id, kind: "other", text: `Requirement: ${condition.type}` };
        }
      }),
    }))
    .sort((a, b) => a.level - b.level);
}

async function getJson<T>(fetchImpl: typeof fetch, url: string): Promise<T> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function fetchPrestige(options: { gameMode?: GameMode; fetchImpl?: typeof fetch } = {}): Promise<PrestigeLevel[]> {
  const { gameMode = DEFAULT_GAME_MODE, fetchImpl = fetch } = options;
  const urlFor = (file: string): string => `${TARKOV_DEV_JSON_BASE_URL}/${gameMode}/${file}`;
  const [tasks, hideout, hideoutEn] = await Promise.all([
    getJson<PrestigeFeeds["tasks"]>(fetchImpl, urlFor("tasks")),
    getJson<PrestigeFeeds["hideout"]>(fetchImpl, urlFor("hideout")),
    getJson<PrestigeFeeds["hideoutEn"]>(fetchImpl, urlFor("hideout_en")),
  ]);
  if (!Array.isArray(tasks?.data?.prestige)) {
    throw new Error("The quest feed has no prestige section");
  }
  return convertPrestigeFeeds({ tasks, hideout, hideoutEn });
}

// ---- cache -------------------------------------------------------------------

const PRESTIGE_CACHE_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

interface PrestigeCache {
  version: number;
  gameMode: GameMode;
  fetchedAt: string;
  levels: PrestigeLevel[];
}

function loadPrestigeCache(path: string, gameMode: GameMode): PrestigeCache | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const cache = JSON.parse(readFileSync(path, "utf-8")) as Partial<PrestigeCache>;
    if (cache.version !== PRESTIGE_CACHE_VERSION || cache.gameMode !== gameMode || typeof cache.fetchedAt !== "string" || !Array.isArray(cache.levels)) {
      return null;
    }
    return cache as PrestigeCache;
  } catch {
    return null;
  }
}

export interface SyncPrestigeOptions {
  gameMode?: GameMode;
  fetchImpl?: typeof fetch;
  maxAgeMs?: number;
  now?: Date;
}

/**
 * The prestige requirements, from a day-old cache or a fresh download. Prestige
 * is a side feature, so this never throws: with no cache and no network the
 * dashboard just says the requirements aren't available.
 */
export async function syncPrestige(cachePath: string, options: SyncPrestigeOptions = {}): Promise<PrestigeLevel[]> {
  const { gameMode = DEFAULT_GAME_MODE, fetchImpl, maxAgeMs = DAY_MS, now = new Date() } = options;
  const cached = loadPrestigeCache(cachePath, gameMode);
  if (cached && now.getTime() - new Date(cached.fetchedAt).getTime() < maxAgeMs) {
    return cached.levels;
  }
  try {
    const levels = await fetchPrestige({ gameMode, fetchImpl });
    const cache: PrestigeCache = { version: PRESTIGE_CACHE_VERSION, gameMode, fetchedAt: now.toISOString(), levels };
    writeFileSync(`${cachePath}.tmp`, JSON.stringify(cache), "utf-8");
    renameSync(`${cachePath}.tmp`, cachePath);
    return levels;
  } catch {
    return cached?.levels ?? [];
  }
}
