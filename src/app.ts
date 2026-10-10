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
import type { PrestigeLevel } from "./prestige/prestigeData.js";
import type { TarkovTask, TaskCache, GameMode } from "./index.js";
import { createServer } from "./server/createServer.js";
import { createApiRoutes } from "./server/apiRoutes.js";
import { isTrackerRunning, openBrowser, shouldOpenBrowser } from "./launcher.js";

export interface AppConfig {
  port?: number;
  logsRootDir?: string;
  cachePath?: string;
  dbPath?: string;
  staticDir?: string;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  /** Which game mode's quests to track. Defaults to the TARKOV_GAME_MODE env var, then PvE. */
  gameMode?: GameMode;
  /** Where the prestige requirements are cached. Defaults to the project folder. */
  prestigeCachePath?: string;
  /** Use these prestige requirements instead of downloading them (for tests). */
  prestigeLevels?: PrestigeLevel[];
}

export interface RunningApp {
  server: Server;
  store: ProgressStore;
  tailer: LogTailer;
  gameMode: GameMode;
}

const DEFAULT_LOGS_ROOT_DIR = "C:\\Battlestate Games\\Escape from Tarkov\\Logs";

const DEFAULT_PORT = 4173;

// The project folder (one above src/ or dist/), so the app finds its database
// and web files no matter which folder a desktop shortcut starts it from.
const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export async function startApp(config: AppConfig = {}): Promise<RunningApp> {
  // Resolved first so an invalid TARKOV_GAME_MODE fails before any real work
  // (network, database, log reading) happens.
  const gameMode = config.gameMode ?? parseGameMode(process.env.TARKOV_GAME_MODE);
  const port = config.port ?? DEFAULT_PORT;
  const logsRootDir = config.logsRootDir ?? process.env.TARKOV_LOGS_DIR ?? DEFAULT_LOGS_ROOT_DIR;
  const cachePath = config.cachePath ?? join(PROJECT_ROOT, ".tarkov-cache.json");
  const dbPath = config.dbPath ?? join(PROJECT_ROOT, ".tarkov-progress.sqlite");
  const staticDir = config.staticDir ?? join(PROJECT_ROOT, "public");

  const tasks: TarkovTask[] = await syncTaskGraph(cachePath, { fetchImpl: config.fetchImpl, gameMode });
  const prestigeLevels =
    config.prestigeLevels ??
    (await syncPrestige(config.prestigeCachePath ?? join(PROJECT_ROOT, ".tarkov-prestige-cache.json"), { fetchImpl: config.fetchImpl, gameMode }));

  const store = new ProgressStore(dbPath);

  runBackfill(logsRootDir, store);

  const tailer = new LogTailer(logsRootDir, store, { pollIntervalMs: config.pollIntervalMs });
  tailer.start();

  const getCache = (): TaskCache | null => loadCache(cachePath);
  const getStorylines = () => deriveStorylines(tasks);
  const routes = createApiRoutes({
    store,
    getCache,
    getTasks: () => tasks,
    getStorylines,
    logsRootDir,
    getPrestige: () => prestigeLevels,
  });

  const server = createServer({ apiRoutes: routes, staticDir });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
  } catch (error) {
    // We already opened the store and started the tailer above — if the
    // listen fails (e.g. EADDRINUSE), don't leak those open resources.
    tailer.stop();
    store.close();
    throw error;
  }

  return { server, store, tailer, gameMode };
}

// pathToFileURL (not manual string/URL construction) is the Node-documented
// way to do this comparison correctly cross-platform — a hand-built "file:"
// URL doesn't reliably handle Windows path separators or encoding.
const isMainModule = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1] as string).href;

async function main(): Promise<void> {
  const open = shouldOpenBrowser(process.argv, process.env);

  if (await isTrackerRunning(DEFAULT_PORT)) {
    const url = `http://127.0.0.1:${DEFAULT_PORT}`;
    console.log(`Tarkov Storyline Tracker is already running - opening ${url}`);
    if (open) {
      openBrowser(url);
    }
    return;
  }

  console.log("Starting Tarkov Storyline Tracker (reading your game logs)...");
  const app = await startApp();
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : DEFAULT_PORT;
  const url = `http://127.0.0.1:${port}`;
  const modeLabel = app.gameMode === "pve" ? "PvE" : "regular";
  console.log(`Tarkov Storyline Tracker running at ${url} (${modeLabel} quests)`);
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
