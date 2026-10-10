import type { ApiHandler } from "./createServer.js";
import { HttpError } from "./createServer.js";
import type { TarkovTask } from "../tarkovData/types.js";
import type { Storyline } from "../storylines/deriveStorylines.js";
import type { ProgressStore } from "../progress/store.js";
import type { TaskCache } from "../tarkovData/cache.js";
import { buildStatusResponse, buildProgressResponse, buildTasksResponse } from "./apiData.js";
import { buildChaptersResponse, setChapterStatus, setObjectiveDone } from "./chaptersApi.js";
import { STORY_CHAPTERS } from "../storyChapters/chapters.js";
import type { StoryChapter } from "../storyChapters/types.js";
import { buildWipeOptions, buildWipePreview, performWipe, parseSince } from "./wipeApi.js";

export interface ApiDeps {
  store: ProgressStore;
  getCache: () => TaskCache | null;
  getTasks: () => TarkovTask[];
  getStorylines: () => Storyline[];
  /** Where the game's logs live — the "reset my progress" flow reads them to help pick the reset moment. */
  logsRootDir: string;
  /** Defaults to the built-in story chapters; tests pass their own. */
  chapters?: StoryChapter[];
}

// The dashboard sends this on every state-changing request. A web page on some
// other site can't add a custom header to a cross-origin request without the
// browser first asking this server for permission (which it never grants), so
// requiring it keeps other sites from triggering a wipe through the user's browser.
const TRACKER_HEADER = "x-requested-with";
const TRACKER_HEADER_VALUE = "tarkov-tracker";

function requireTrackerHeader(req: { headers: Record<string, string | string[] | undefined> }): void {
  if (req.headers[TRACKER_HEADER] !== TRACKER_HEADER_VALUE) {
    throw new HttpError(403, "This request must come from the tracker's own dashboard");
  }
}

export function createApiRoutes(deps: ApiDeps): Record<string, ApiHandler> {
  const wipeDeps = { store: deps.store, logsRootDir: deps.logsRootDir, getTasks: deps.getTasks };
  const chapterDeps = { store: deps.store, chapters: deps.chapters ?? STORY_CHAPTERS };

  return {
    "GET /api/status": () => buildStatusResponse(deps.getCache(), deps.store),
    "GET /api/progress": () => buildProgressResponse(deps.getTasks(), deps.getStorylines(), deps.store),
    "GET /api/tasks": (url) =>
      buildTasksResponse(deps.getTasks(), deps.getStorylines(), deps.store, {
        storyline: url.searchParams.get("storyline") ?? undefined,
        trader: url.searchParams.get("trader") ?? undefined,
        map: url.searchParams.get("map") ?? undefined,
      }),

    "GET /api/wipe/options": () => buildWipeOptions(wipeDeps),
    "GET /api/wipe/preview": (url) => buildWipePreview(wipeDeps, parseSince(url.searchParams.get("since"))),
    "POST /api/wipe": (url, req) => {
      requireTrackerHeader(req);
      return performWipe(wipeDeps, parseSince(url.searchParams.get("since")));
    },

    "GET /api/chapters": () => buildChaptersResponse(chapterDeps),
    "POST /api/chapters/status": (url, req) => {
      requireTrackerHeader(req);
      return setChapterStatus(chapterDeps, url.searchParams.get("chapter"), url.searchParams.get("status"));
    },
    "POST /api/chapters/objective": (url, req) => {
      requireTrackerHeader(req);
      return setObjectiveDone(
        chapterDeps,
        url.searchParams.get("chapter"),
        url.searchParams.get("index"),
        url.searchParams.get("done") === "1"
      );
    },
  };
}
