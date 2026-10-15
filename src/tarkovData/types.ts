export interface TarkovTrader {
  id: string;
  name: string;
}

export interface TarkovMap {
  id: string;
  name: string;
}

/** Something the player has to take into the raid for an objective: a marker, a key, an item to plant... */
export interface BringRequirement {
  kind: "item" | "marker" | "key" | "use" | "weapon" | "gear";
  /** Any one of these will do (just one name when there's no choice). */
  names: string[];
  count: number;
}

export interface TaskObjective {
  id: string | null;
  type: string;
  description: string;
  optional: boolean;
  /**
   * What to bring into a raid for this objective. Undefined when the item names weren't available
   * (an older saved copy, or the GraphQL fallback); an empty list when nothing is needed.
   */
  bring?: BringRequirement[];
}

export interface TaskStatusRequirement {
  status: string[];
  task: { id: string };
}

/** "This quest fails if that quest reaches one of these states" (the feed's way of saying two quests exclude each other). */
export interface FailIfTask {
  taskId: string;
  status: string[];
}

export interface TarkovTask {
  id: string;
  name: string;
  trader: TarkovTrader;
  map: TarkovMap | null;
  wikiLink: string | null;
  kappaRequired: boolean;
  lightkeeperRequired: boolean;
  factionName: string | null;
  minPlayerLevel: number | null;
  objectives: TaskObjective[];
  taskRequirements: TaskStatusRequirement[];
  /**
   * Quests whose outcome fails this one, e.g. completing "Big Customer" fails "Chemical - Part 4". Undefined from
   * sources that don't carry it (an older saved copy, the GraphQL fallback); an empty list when there are none.
   */
  failIfTasks?: FailIfTask[];
}
