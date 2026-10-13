import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Server } from "node:http";
import {
  syncTaskGraph,
  runBackfill,
  LogTailer,
  ProgressStore,
  deriveStorylines,
  loadCache,
  parseGameMode,
} from "./index.js";
import { syncPrestige } from "./prestige/prestigeData.js";
import { createQuestGuideService } from "./wiki/questGuide.js";
import { findLogsDir } from "./logsLocator.js";
import type { LogsLocation } from "./logsLocator.js";
import type { PrestigeLevel } from "./prestige/prestigeData.js";
import type { TarkovTask, TaskCache, GameMode } from "./index.js";
import { createServer } from "./server/createServer.js";
import { createApiRoutes } from "./server/apiRoutes.js";
import { findRunningTracker, openBrowser, shouldOpenBrowser } from "./launcher.js";
import { DEFAULT_GAME_MODE, GAME_MODE_LABELS, isGameMode } from "./tarkovData/gameMode.js";

export interface AppConfig {
  port?: number;
  logsRootDir?: string;
  cachePath?: string;
  dbPath?: string;
  staticDir?: string;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  /** Which game mode to show. Defaults to the TARKOV_GAME_MODE env var, then the mode last viewed, then PvE. */
  gameMode?: GameMode;
  /** Where the prestige requirements are cached. Defaults to the project folder. */
  prestigeCachePath?: string;
  /** Use these prestige requirements instead of downloading them (for tests). */
  prestigeLevels?: PrestigeLevel[];
  /** If the port is taken, use the next free one instead of failing. */
  findFreePort?: boolean;
  /** How often quest data is refreshed while the app runs. Defaults to every 6 hours. */
  refreshIntervalMs?: number;
}

export interface RunningApp {
  /** Where the game's logs are being read from. */
  logs: LogsLocation;
  server: Server;
  store: ProgressStore;
  tailer: LogTailer;
  gameMode: GameMode;
}


// 4173 unless TARKOV_PORT says otherwise (e.g. to run a second copy for trying things out).
const PORT_FROM_ENV = Number(process.env.TARKOV_PORT);
const PORT_ATTEMPTS = 20;
const DEFAULT_REFRESH_MS = 6 * 60 * 60 * 1000;
const DEFAULT_PORT = Number.isInteger(PORT_FROM_ENV) && PORT_FROM_ENV > 0 && PORT_FROM_ENV < 65536 ? PORT_FROM_ENV : 4173;

// The project folder (one above src/ or dist/), so the app finds its database
// and web files no matter which folder a desktop shortcut starts it from.
const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** The saved-data file for a mode: PvE keeps the original name, the others get the mode in it (cache.json -> cache-regular.json). */
function pathForMode(path: string, mode: GameMode): string {
  return mode === DEFAULT_GAME_MODE ? path : path.replace(/(\.json)?$/, `-${mode}$1`);
}

export async function startApp(config: AppConfig = {}): Promise<RunningApp> {
  // An explicit choice (config, or TARKOV_GAME_MODE) is resolved first so an invalid one fails before any
  // real work (network, database, log reading) happens. Otherwise the mode the player last viewed is used.
  const envMode = process.env.TARKOV_GAME_MODE?.trim() ? parseGameMode(process.env.TARKOV_GAME_MODE) : undefined;
  const explicitMode: GameMode | undefined = config.gameMode ?? envMode;
  const port = config.port ?? DEFAULT_PORT;
  // Saved progress and downloaded data live in the project folder unless TARKOV_DATA_DIR points elsewhere
  // (handy for trying things out without touching your real progress).
  const dataDir = process.env.TARKOV_DATA_DIR ?? PROJECT_ROOT;
  mkdirSync(dataDir, { recursive: true });
  // Where the game's logs are: an explicit setting, else found by looking (BSG Launcher's settings, the usual folders).
  const logs: LogsLocation = config.logsRootDir
    ? { dir: config.logsRootDir, found: existsSync(config.logsRootDir), source: "TARKOV_LOGS_DIR", tried: [config.logsRootDir] }
    : findLogsDir({ dataDir });
  const logsRootDir = logs.dir;
  const cacheBase = config.cachePath ?? join(dataDir, ".tarkov-cache.json");
  const prestigeCacheBase = config.prestigeCachePath ?? join(dataDir, ".tarkov-prestige-cache.json");
  const dbPath = config.dbPath ?? join(dataDir, ".tarkov-progress.sqlite");
  const staticDir = config.staticDir ?? join(PROJECT_ROOT, "public");

  const store = new ProgressStore(dbPath);
  const remembered = store.getMeta("viewMode");
  const initialMode: GameMode = explicitMode ?? (isGameMode(remembered) ? remembered : DEFAULT_GAME_MODE);
  store.setMode(initialMode);

  // One mode's quest data and prestige requirements (from a saved copy or the network).
  const loadModeData = async (mode: GameMode): Promise<{ tasks: TarkovTask[]; prestigeLevels: PrestigeLevel[] }> => ({
    tasks: await syncTaskGraph(pathForMode(cacheBase, mode), { fetchImpl: config.fetchImpl, gameMode: mode }),
    prestigeLevels: config.prestigeLevels ?? (await syncPrestige(pathForMode(prestigeCacheBase, mode), { fetchImpl: config.fetchImpl, gameMode: mode })),
  });
  const current = { mode: initialMode, tasks: [] as TarkovTask[], prestigeLevels: [] as PrestigeLevel[] };
  try {
    Object.assign(current, await loadModeData(initialMode));
  } catch (error) {
    store.close();
    throw error;
  }

  // Quest walkthroughs are fetched from the wiki the first time a quest's guide is opened, then kept on disk.
  const questGuides = createQuestGuideService({ cacheDir: join(dataDir, ".tarkov-wiki-cache") });

  // Quest messages are filed under the mode they happened in, whichever mode is on screen; the fallback is for
  // a message whose mode the logs can't tell.
  const fallbackMode = explicitMode ?? DEFAULT_GAME_MODE;
  runBackfill(logsRootDir, store, { fallbackMode });

  const tailer = new LogTailer(logsRootDir, store, { pollIntervalMs: config.pollIntervalMs, fallbackMode });
  tailer.start();

  const getCache = (): TaskCache | null => loadCache(pathForMode(cacheBase, current.mode));
  const getStorylines = () => deriveStorylines(current.tasks);
  const routes = createApiRoutes({
    store,
    getCache,
    getTasks: () => current.tasks,
    getStorylines,
    logsRootDir,
    getPrestige: () => current.prestigeLevels,
    getGameMode: () => current.mode,
    switchMode: async (mode) => {
      if (mode === current.mode) {
        return;
      }
      // Load the other mode's data first: if that fails, nothing has changed.
      const data = await loadModeData(mode);
      current.tasks = data.tasks;
      current.prestigeLevels = data.prestigeLevels;
      current.mode = mode;
      store.setMode(mode);
      store.setMeta("viewMode", mode);
    },
    logsFolder: { path: logs.dir, found: logs.found, source: logs.source, tried: logs.tried, settingsFile: join(dataDir, "settings.json") },
    getQuestGuide: async (taskId) => {
      const task = current.tasks.find((candidate) => candidate.id === taskId);
      return task ? questGuides.get(task.wikiLink) : null;
    },
  });

  const server = createServer({ apiRoutes: routes, staticDir });
  try {
    // If the port is taken and the caller allows it, move up to the next free one.
    const attempts = config.findFreePort ? PORT_ATTEMPTS : 1;
    for (let attempt = 0; ; attempt++) {
      try {
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(port + attempt, "127.0.0.1", () => {
            server.removeListener("error", reject);
            resolve();
          });
        });
        break;
      } catch (error) {
        server.removeAllListeners("error");
        if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || attempt + 1 >= attempts) {
          throw error;
        }
      }
    }
  } catch (error) {
    // We already opened the store and started the tailer above — if the
    // listen fails (e.g. EADDRINUSE), don't leak those open resources.
    tailer.stop();
    store.close();
    throw error;
  }

  // Quest data (and prestige requirements) for the mode on screen are checked again every few hours, so a tracker
  // left open across a game update or new quests keeps up. A failed refresh keeps what it has.
  const refreshMs = config.refreshIntervalMs ?? DEFAULT_REFRESH_MS;
  const refresh = setInterval(() => {
    const mode = current.mode;
    syncTaskGraph(pathForMode(cacheBase, mode), { fetchImpl: config.fetchImpl, gameMode: mode, maxAgeMs: refreshMs })
      .then((fresh) => {
        if (current.mode === mode) current.tasks = fresh;
      })
      .catch(() => undefined);
    if (!config.prestigeLevels) {
      syncPrestige(pathForMode(prestigeCacheBase, mode), { fetchImpl: config.fetchImpl, gameMode: mode, maxAgeMs: refreshMs })
        .then((fresh) => {
          if (fresh.length > 0 && current.mode === mode) current.prestigeLevels = fresh;
        })
        .catch(() => undefined);
    }
  }, refreshMs);
  refresh.unref();
  server.on("close", () => clearInterval(refresh));

  return {
    server,
    store,
    tailer,
    logs,
    get gameMode() {
      return current.mode;
    },
  };
}

// pathToFileURL (not manual string/URL construction) is the Node-documented
// way to do this comparison correctly cross-platform — a hand-built "file:"
// URL doesn't reliably handle Windows path separators or encoding.
const isMainModule = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1] as string).href;

async function main(): Promise<void> {
  const open = shouldOpenBrowser(process.argv, process.env);

  const runningOn = await findRunningTracker(DEFAULT_PORT, PORT_ATTEMPTS);
  if (runningOn !== null) {
    const url = `http://127.0.0.1:${runningOn}`;
    console.log(`Tarkov Storyline Tracker is already running - opening ${url}`);
    if (open) {
      openBrowser(url);
    }
    return;
  }

  console.log("Starting Tarkov Storyline Tracker (reading your game logs)...");
  // Unless a port was asked for, a taken one (something else using 4173) just means using the next free one.
  const app = await startApp({ findFreePort: !process.env.TARKOV_PORT });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : DEFAULT_PORT;
  const url = `http://127.0.0.1:${port}`;
  console.log(`Tarkov Storyline Tracker running at ${url} (${GAME_MODE_LABELS[app.gameMode]} quests)`);
  if (app.logs.found) {
    console.log(`Reading your game logs from ${app.logs.dir} (found via ${app.logs.source}).`);
  } else {
    console.log(`WARNING: couldn't find your Escape from Tarkov logs folder. Looked in:\n  ${app.logs.tried.join("\n  ")}`);
    console.log("Open the tracker in your browser for how to point it at the right folder.");
  }
  console.log("Leave this window open while you use it. Close it to stop the tracker.");
  if (open) {
    openBrowser(url);
  }
}

if (isMainModule) {
  main().catch((error) => {
    console.error("Failed to start:", error);
    process.exit(1);
  });
}
