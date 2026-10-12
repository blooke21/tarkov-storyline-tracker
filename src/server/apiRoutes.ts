import type { ApiHandler } from "./createServer.js";
import { HttpError } from "./createServer.js";
import type { TarkovTask } from "../tarkovData/types.js";
import type { Storyline } from "../storylines/deriveStorylines.js";
import type { ProgressStore } from "../progress/store.js";
import type { TaskCache } from "../tarkovData/cache.js";
import type { LogsFolderInfo } from "./apiData.js";
import { buildStatusResponse, buildProgressResponse, buildTasksResponse } from "./apiData.js";
import { buildChaptersResponse, buildGuideResponse, setChapterPosition, setChapterStatus, setObjectiveDone } from "./chaptersApi.js";
import { STORY_CHAPTERS } from "../storyChapters/chapters.js";
import type { StoryChapter } from "../storyChapters/types.js";
import { scanLogs } from "./scanApi.js";
import { setPinned } from "./pinsApi.js";
import { buildBringResponse } from "./bringApi.js";
import { buildPrestigeResponse, setPrestigeCondition, setPrestigeLevel } from "./prestigeApi.js";
import type { PrestigeLevel } from "../prestige/prestigeData.js";
import type { GameMode } from "../tarkovData/gameMode.js";
import type { QuestGuide } from "../wiki/questGuide.js";
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
  /** The prestige requirements. Optional: with none, the dashboard says they are unavailable. */
  getPrestige?: () => PrestigeLevel[];
  /** Which game mode's quests and prestige rules are in use. Defaults to PvE. */
  gameMode?: GameMode;
  /** Where the game's logs are read from, for the dashboard to show if they can't be found. */
  logsFolder?: LogsFolderInfo;
  /** The wiki's walkthrough for a quest, by quest id: null for an unknown quest, throws if the wiki can't be reached. */
  getQuestGuide?: (taskId: string) => Promise<QuestGuide | null>;
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
  const prestigeDeps = {
    store: deps.store,
    getTasks: deps.getTasks,
    getLevels: deps.getPrestige ?? (() => []),
    gameMode: deps.gameMode,
    getChapter: (chapterId: string) => {
      const chapter = buildChaptersResponse(chapterDeps).chapters.find((candidate) => candidate.id === chapterId);
      return chapter ? { name: chapter.name, done: chapter.status === "done" } : undefined;
    },
  };

  return {
    "GET /api/status": () => buildStatusResponse(deps.getCache(), deps.store, deps.logsFolder ?? null),
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

    "POST /api/scan": (_url, req) => {
      requireTrackerHeader(req);
      return scanLogs(wipeDeps);
    },

    "POST /api/pins": (url, req) => {
      requireTrackerHeader(req);
      return setPinned(
        { store: deps.store, getTasks: deps.getTasks },
        url.searchParams.get("task"),
        url.searchParams.get("pinned") === "1"
      );
    },

    "GET /api/quests/guide": async (url) => {
      if (!deps.getQuestGuide) {
        throw new HttpError(404, "Quest walkthroughs aren't available");
      }
      const taskId = url.searchParams.get("task") ?? "";
      let guide: QuestGuide | null;
      try {
        guide = await deps.getQuestGuide(taskId);
      } catch (error) {
        throw new HttpError(502, `Couldn't get the walkthrough from the wiki (${error instanceof Error ? error.message : "unknown error"})`);
      }
      if (!guide) {
        throw new HttpError(404, `No walkthrough for quest "${taskId}"`);
      }
      return guide;
    },

    "GET /api/pinned/bring": () => buildBringResponse({ store: deps.store, getTasks: deps.getTasks, getQuestGuide: deps.getQuestGuide }),

    "GET /api/prestige": () => buildPrestigeResponse(prestigeDeps),
    "POST /api/prestige/level": (url, req) => {
      requireTrackerHeader(req);
      return setPrestigeLevel(prestigeDeps, url.searchParams.get("level"));
    },
    "POST /api/prestige/requirement": (url, req) => {
      requireTrackerHeader(req);
      return setPrestigeCondition(prestigeDeps, url.searchParams.get("requirement"), url.searchParams.get("done") === "1");
    },

    "GET /api/chapters": () => buildChaptersResponse(chapterDeps),
    "GET /api/chapters/guide": (url) => buildGuideResponse(chapterDeps, url.searchParams.get("chapter")),
    "POST /api/chapters/status": (url, req) => {
      requireTrackerHeader(req);
      return setChapterStatus(chapterDeps, url.searchParams.get("chapter"), url.searchParams.get("status"));
    },
    "POST /api/chapters/position": (url, req) => {
      requireTrackerHeader(req);
      return setChapterPosition(chapterDeps, url.searchParams.get("chapter"), url.searchParams.get("index"));
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
