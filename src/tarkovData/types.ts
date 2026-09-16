export interface TarkovTrader {
  id: string;
  name: string;
}

export interface TarkovMap {
  id: string;
  name: string;
}

export interface TaskObjective {
  id: string | null;
  type: string;
  description: string;
  optional: boolean;
}

export interface TaskStatusRequirement {
  status: string[];
  task: { id: string };
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
}
