import type { ApiHandler } from "./createServer.js";
import type { TarkovTask } from "../tarkovData/types.js";
import type { Storyline } from "../storylines/deriveStorylines.js";
import type { ProgressStore } from "../progress/store.js";
import type { TaskCache } from "../tarkovData/cache.js";
import { buildStatusResponse, buildProgressResponse, buildTasksResponse } from "./apiData.js";

export interface ApiDeps {
  store: ProgressStore;
  getCache: () => TaskCache | null;
  getTasks: () => TarkovTask[];
  getStorylines: () => Storyline[];
}

export function createApiRoutes(deps: ApiDeps): Record<string, ApiHandler> {
  return {
    "GET /api/status": () => buildStatusResponse(deps.getCache(), deps.store),
    "GET /api/progress": () => buildProgressResponse(deps.getTasks(), deps.getStorylines(), deps.store),
    "GET /api/tasks": (url) =>
      buildTasksResponse(deps.getTasks(), deps.getStorylines(), deps.store, {
        storyline: url.searchParams.get("storyline") ?? undefined,
        trader: url.searchParams.get("trader") ?? undefined,
        map: url.searchParams.get("map") ?? undefined,
      }),
  };
}
