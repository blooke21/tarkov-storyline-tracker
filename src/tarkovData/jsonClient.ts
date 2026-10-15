import { DEFAULT_GAME_MODE, type GameMode } from "./gameMode.js";
import type { BringRequirement, FailIfTask, TarkovTask } from "./types.js";

/**
 * tarkov.dev's static JSON feed — the same data its own website runs on. It
 * exists because the GraphQL API (api.tarkov.dev) went down around
 * 2026-07-21 and, at the time of writing, hasn't come back. The shape differs
 * from GraphQL in ways the converter below has to bridge:
 *
 *  - tasks come as an object keyed by id, not an array;
 *  - names and descriptions are translation keys ("<taskId> name"; an
 *    objective's "description" is just its own id), with the English text in
 *    separate `*_en` files;
 *  - trader, map, and requirement references are bare ids, not objects.
 */
export const TARKOV_DEV_JSON_BASE_URL = "https://json.tarkov.dev";

const REQUEST_TIMEOUT_MS = 30_000;

export interface RawObjective {
  id?: string | null;
  type?: string;
  description?: string;
  optional?: boolean;
  [key: string]: unknown;
}

export interface RawTask {
  id: string;
  name: string;
  trader: string;
  map?: string | null;
  wikiLink?: string | null;
  minPlayerLevel?: number | null;
  factionName?: string | null;
  kappaRequired?: boolean;
  lightkeeperRequired?: boolean;
  objectives?: RawObjective[];
  taskRequirements?: Array<{ task: string; status?: string[] }>;
  [key: string]: unknown;
}

type Translations = Record<string, string>;

export interface JsonFeed {
  tasks: Record<string, RawTask>;
  tasksEn: Translations;
  tradersEn: Translations;
  mapsEn: Translations;
  /** Item names ("<id> Name"). Without it the objectives carry no "bring" list. */
  itemsEn?: Translations;
}

/** English text for a translation key, or undefined if it's missing or blank. */
function translate(table: Translations, key: string | null | undefined): string | undefined {
  if (!key) {
    return undefined;
  }
  const value = table[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

const MAX_ALTERNATIVES = 6;
const MAX_WEAPON_CHOICES = 4;

/** Item ids -> distinct English names (ids it doesn't know are left out). */
function itemNames(table: Translations, ids: unknown): string[] {
  const list = Array.isArray(ids) ? ids : ids ? [ids] : [];
  const names = list.flatMap((id) => (typeof id === "string" ? [translate(table, `${id} Name`)] : [])).filter((name): name is string => Boolean(name));
  return [...new Set(names)];
}

/** [["a"], ["b", "c"]] or ["a", "b"] -> [["a"], ["b", "c"]]: every group is needed, any one item in a group will do. */
function itemGroups(value: unknown): unknown[][] {
  return Array.isArray(value) ? value.map((entry) => (Array.isArray(entry) ? entry : [entry])) : [];
}

/**
 * What the player must take into a raid to do an objective, from the feed's
 * structured fields: markers to place, items to plant or use, keys, and the
 * weapon or gear a kill has to be made with. Items to hand in or find in the
 * raid are not "bring" items and aren't listed.
 */
export function extractBring(objective: RawObjective, items: Translations): BringRequirement[] {
  const count = typeof objective.count === "number" && objective.count >= 1 ? objective.count : 1;
  const bring: BringRequirement[] = [];
  const add = (kind: BringRequirement["kind"], names: string[], amount = 1, limit = MAX_ALTERNATIVES): void => {
    if (names.length > 0 && names.length <= limit) {
      bring.push({ kind, names, count: amount });
    }
  };

  if (objective.type === "mark") {
    add("marker", itemNames(items, objective.markerItem), count);
  } else if (objective.type === "plantItem") {
    add("item", itemNames(items, objective.items), count);
  } else if (objective.type === "useItem") {
    add("use", itemNames(items, objective.useAny), count);
  } else if (objective.type === "shoot") {
    add("weapon", itemNames(items, objective.usingWeapon), 1, MAX_WEAPON_CHOICES);
    for (const group of itemGroups(objective.usingWeaponMods)) {
      add("weapon", itemNames(items, group), 1, MAX_WEAPON_CHOICES);
    }
    for (const group of itemGroups(objective.wearing)) {
      add("gear", itemNames(items, group));
    }
  }
  for (const group of itemGroups(objective.requiredKeys)) {
    add("key", itemNames(items, group));
  }
  return bring;
}

/** The quests this one fails alongside, from the feed's fail conditions (only quest-status ones; duplicates collapsed). */
export function extractFailIfTasks(raw: RawTask): FailIfTask[] {
  const conditions = Array.isArray(raw.failConditions) ? (raw.failConditions as Array<Record<string, unknown>>) : [];
  const found = new Map<string, FailIfTask>();
  for (const condition of conditions) {
    if (condition?.type !== "taskStatus" || typeof condition.task !== "string") {
      continue;
    }
    const status = Array.isArray(condition.status) ? condition.status.filter((s): s is string => typeof s === "string") : [];
    const key = `${condition.task}|${[...status].sort().join(",")}`;
    found.set(key, { taskId: condition.task, status });
  }
  return [...found.values()];
}

export function convertJsonFeed(feed: JsonFeed): TarkovTask[] {
  return Object.entries(feed.tasks).map(([key, raw]) => {
    const mapId = raw.map ?? null;
    return {
      id: raw.id ?? key,
      name: translate(feed.tasksEn, raw.name) ?? raw.name,
      trader: {
        id: raw.trader,
        name: translate(feed.tradersEn, `${raw.trader} Nickname`) ?? raw.trader,
      },
      map: mapId ? { id: mapId, name: translate(feed.mapsEn, `${mapId} Name`) ?? mapId } : null,
      wikiLink: raw.wikiLink ?? null,
      kappaRequired: raw.kappaRequired === true,
      lightkeeperRequired: raw.lightkeeperRequired === true,
      factionName: raw.factionName ?? null,
      minPlayerLevel: raw.minPlayerLevel ?? null,
      objectives: (raw.objectives ?? []).map((objective) => ({
        id: objective.id ?? null,
        type: objective.type ?? "",
        description:
          translate(feed.tasksEn, objective.description) ??
          translate(feed.tasksEn, objective.id) ??
          objective.description ??
          "",
        optional: objective.optional === true,
        ...(feed.itemsEn ? { bring: extractBring(objective, feed.itemsEn) } : {}),
      })),
      taskRequirements: (raw.taskRequirements ?? []).map((requirement) => ({
        status: requirement.status ?? [],
        task: { id: requirement.task },
      })),
      failIfTasks: extractFailIfTasks(raw),
    };
  });
}

async function getData(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

  if (!response.ok) {
    throw new Error(`tarkov.dev JSON feed request failed: ${url} -> ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as { data?: unknown };
  if (body.data === undefined || body.data === null) {
    throw new Error(`tarkov.dev JSON feed returned no data: ${url}`);
  }
  return body.data;
}

function expectRecord(data: unknown, url: string): Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`tarkov.dev JSON feed returned an unexpected shape (expected an object): ${url}`);
  }
  return data as Record<string, unknown>;
}

export interface FetchTasksFromJsonOptions {
  gameMode?: GameMode;
  fetchImpl?: typeof fetch;
}

/**
 * Fetches the task graph for one game mode from the JSON feed. Only the four
 * small files this needs are requested (~2.4 MB total) — the feed's much
 * larger maps file isn't needed because map names are available directly in
 * `maps_en`.
 */
export async function fetchTasksFromJson(options: FetchTasksFromJsonOptions = {}): Promise<TarkovTask[]> {
  const gameMode = options.gameMode ?? DEFAULT_GAME_MODE;
  const fetchImpl = options.fetchImpl ?? fetch;
  const urlFor = (file: string): string => `${TARKOV_DEV_JSON_BASE_URL}/${gameMode}/${file}`;

  const [tasksData, tasksEn, tradersEn, mapsEn, itemsEn] = await Promise.all([
    getData(fetchImpl, urlFor("tasks")),
    getData(fetchImpl, urlFor("tasks_en")),
    getData(fetchImpl, urlFor("traders_en")),
    getData(fetchImpl, urlFor("maps_en")),
    // Item names make the "what to bring" lists possible; the rest works without them, so a failure here isn't fatal.
    getData(fetchImpl, urlFor("items_en")).catch(() => null),
  ]);

  const tasksUrl = urlFor("tasks");
  const tasks = expectRecord(expectRecord(tasksData, tasksUrl).tasks, `${tasksUrl} (its "tasks" field)`);

  return convertJsonFeed({
    tasks: tasks as Record<string, RawTask>,
    tasksEn: expectRecord(tasksEn, urlFor("tasks_en")) as Translations,
    tradersEn: expectRecord(tradersEn, urlFor("traders_en")) as Translations,
    mapsEn: expectRecord(mapsEn, urlFor("maps_en")) as Translations,
    itemsEn: itemsEn ? (expectRecord(itemsEn, urlFor("items_en")) as Translations) : undefined,
  });
}
