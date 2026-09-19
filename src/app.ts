import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Server } from "node:http";
import {
  syncTaskGraph,
  runBackfill,
  LogTailer,
  ProgressStore,
  deriveStorylines,
  loadCache,
} from "./index.js";
import type { TarkovTask, TaskCache } from "./index.js";
import { createServer } from "./server/createServer.js";
import { createApiRoutes } from "./server/apiRoutes.js";

export interface AppConfig {
  port?: number;
  logsRootDir?: string;
  cachePath?: string;
  dbPath?: string;
  staticDir?: string;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
}

export interface RunningApp {
  server: Server;
  store: ProgressStore;
  tailer: LogTailer;
}

const DEFAULT_LOGS_ROOT_DIR = "C:\\Battlestate Games\\Escape from Tarkov\\Logs";

export async function startApp(config: AppConfig = {}): Promise<RunningApp> {
  const port = config.port ?? 4173;
  const logsRootDir = config.logsRootDir ?? process.env.TARKOV_LOGS_DIR ?? DEFAULT_LOGS_ROOT_DIR;
  const cachePath = config.cachePath ?? join(process.cwd(), ".tarkov-cache.json");
  const dbPath = config.dbPath ?? join(process.cwd(), ".tarkov-progress.sqlite");
  const staticDir = config.staticDir ?? join(process.cwd(), "public");

  const tasks: TarkovTask[] = await syncTaskGraph(cachePath, { fetchImpl: config.fetchImpl });

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

  return { server, store, tailer };
}

// pathToFileURL (not manual string/URL construction) is the Node-documented
// way to do this comparison correctly cross-platform — a hand-built "file:"
// URL doesn't reliably handle Windows path separators or encoding.
const isMainModule = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1] as string).href;

if (isMainModule) {
  startApp()
    .then((app) => {
      const address = app.server.address();
      const port = typeof address === "object" && address ? address.port : "unknown";
      console.log(`Tarkov Storyline Tracker running at http://127.0.0.1:${port}`);
    })
    .catch((error) => {
      console.error("Failed to start:", error);
      process.exit(1);
    });
}
