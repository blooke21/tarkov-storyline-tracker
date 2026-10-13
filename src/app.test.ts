import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { startApp } from "./app.js";
import type { AppConfig } from "./app.js";
import { jsonFeedSample } from "./tarkovData/__fixtures__/jsonFeedSample.js";
import { createFakeFeedFetch } from "./tarkovData/__fixtures__/fakeFeedFetch.js";

let tempDir: string | undefined;
let app: Awaited<ReturnType<typeof startApp>> | undefined;
let savedGameModeEnv: string | undefined;

afterEach(async () => {
  if (app) {
    app.tailer.stop();
    await new Promise<void>((resolve) => app!.server.close(() => resolve()));
    app.store.close();
    app = undefined;
  }
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
  if (savedGameModeEnv === undefined) {
    delete process.env.TARKOV_GAME_MODE;
  } else {
    process.env.TARKOV_GAME_MODE = savedGameModeEnv;
  }
});

/** Builds a temp workspace and a config pointing at it, with the real-data fake feed standing in for the network. */
function setUp(overrides: Partial<AppConfig> = {}) {
  tempDir = mkdtempSync(join(tmpdir(), "tarkov-app-test-"));
  const staticDir = join(tempDir, "public");
  mkdirSync(staticDir);
  writeFileSync(join(staticDir, "index.html"), "<h1>ok</h1>");
  const logsRootDir = join(tempDir, "logs");
  mkdirSync(logsRootDir);
  const fake = createFakeFeedFetch();
  const config: AppConfig = {
    port: 0,
    logsRootDir,
    cachePath: join(tempDir, "cache.json"),
    dbPath: join(tempDir, "progress.sqlite"),
    staticDir,
    fetchImpl: fake.fetchImpl,
    prestigeLevels: [],
    ...overrides,
  };
  return { config, fake, logsRootDir };
}

function baseUrl(running: { server: { address(): unknown } }): string {
  return `http://127.0.0.1:${(running.server.address() as AddressInfo).port}`;
}

describe("startApp", () => {
  it("wires fetch -> cache -> backfill -> server into a working local app", async () => {
    const { config, fake } = setUp();

    app = await startApp(config);

    const progress = (await (await fetch(`${baseUrl(app)}/api/progress`)).json()) as {
      overall: { totalTasks: number; completedTasks: number };
      storylines: unknown[];
    };
    expect(progress.overall).toEqual({ totalTasks: Object.keys(jsonFeedSample.tasks).length, completedTasks: 0 });
    expect(progress.storylines.length).toBeGreaterThan(0);

    const indexResponse = await fetch(`${baseUrl(app)}/`);
    expect(await indexResponse.text()).toBe("<h1>ok</h1>");

    expect(fake.jsonSyncCount()).toBe(1);
  });

  it("serves real quest names, not unresolved translation keys, through the API", async () => {
    const { config } = setUp();

    app = await startApp(config);

    const body = (await (await fetch(`${baseUrl(app)}/api/tasks`)).json()) as { tasks: Array<{ id: string; name: string; trader: string; map: string | null }> };
    const firstInLine = body.tasks.find((t) => t.id === "657315ddab5a49b71f098853");
    expect(firstInLine).toMatchObject({ name: "First in Line", trader: "Therapist", map: "Ground Zero" });
  });

  it("carries a real-format quest-completed log event all the way through to the API as progress", async () => {
    const { config, logsRootDir } = setUp();
    const sessionDir = join(logsRootDir, "log_2026.09.16_13-19-26_1.1.5.0.47426");
    mkdirSync(sessionDir);
    writeFileSync(
      join(sessionDir, "2026.09.16_13-19-26_1.1.5.0.47426 push-notifications_000.log"),
      [
        "2026-09-16 13:20:00.000|1.1.5.0.47426|Info|push-notifications|Got notification | ChatMessageReceived",
        "{",
        '  "message": { "type": 12, "dt": 1763264233, "templateId": "657315ddab5a49b71f098853 successMessageText dialog 0" }',
        "}",
      ].join("\n")
    );

    app = await startApp(config);

    const progress = (await (await fetch(`${baseUrl(app)}/api/progress`)).json()) as {
      overall: { completedTasks: number };
    };
    expect(progress.overall.completedTasks).toBe(1);
    const tasks = (await (await fetch(`${baseUrl(app)}/api/tasks`)).json()) as { tasks: Array<{ id: string; status: string | null }> };
    expect(tasks.tasks.find((t) => t.id === "657315ddab5a49b71f098853")?.status).toBe("completed");
  });

  it("defaults to PvE data", async () => {
    const { config, fake } = setUp();

    app = await startApp(config);

    expect(app.gameMode).toBe("pve");
    expect(fake.calls.every((url) => url.includes("/pve/"))).toBe(true);
  });

  it("uses the gameMode from config", async () => {
    const { config, fake } = setUp({ gameMode: "regular" });

    app = await startApp(config);

    expect(app.gameMode).toBe("regular");
    expect(fake.calls.every((url) => url.includes("/regular/"))).toBe(true);
  });

  it("uses TARKOV_GAME_MODE when config doesn't set a mode", async () => {
    savedGameModeEnv = process.env.TARKOV_GAME_MODE;
    process.env.TARKOV_GAME_MODE = "regular";
    const { config } = setUp();

    app = await startApp(config);

    expect(app.gameMode).toBe("regular");
  });

  it("lets config override TARKOV_GAME_MODE", async () => {
    savedGameModeEnv = process.env.TARKOV_GAME_MODE;
    process.env.TARKOV_GAME_MODE = "regular";
    const { config } = setUp({ gameMode: "pve" });

    app = await startApp(config);

    expect(app.gameMode).toBe("pve");
  });

  it("rejects an invalid TARKOV_GAME_MODE with a clear error instead of guessing", async () => {
    savedGameModeEnv = process.env.TARKOV_GAME_MODE;
    process.env.TARKOV_GAME_MODE = "arena";
    const { config, fake } = setUp();

    await expect(startApp(config)).rejects.toThrow(/TARKOV_GAME_MODE.*arena/);

    // It must fail before doing any real work (no network calls made).
    expect(fake.calls).toEqual([]);
  });

  it("rejects instead of hanging forever when the port is already in use", async () => {
    const { config } = setUp();
    const blocker = createHttpServer((_req, res) => res.end());
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const occupiedPort = (blocker.address() as AddressInfo).port;

    await expect(startApp({ ...config, port: occupiedPort })).rejects.toThrow(/EADDRINUSE/);

    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  });

  it("moves up to the next free port when asked to and the port is taken", async () => {
    const { config } = setUp();
    const blocker = createHttpServer((_req, res) => res.end());
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const taken = (blocker.address() as AddressInfo).port;

    app = await startApp({ ...config, port: taken, findFreePort: true });

    expect((app.server.address() as AddressInfo).port).toBeGreaterThan(taken);
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  });

  it("checks for new quest data again while it runs", async () => {
    const { config, fake } = setUp();

    app = await startApp({ ...config, refreshIntervalMs: 30 });
    expect(fake.jsonSyncCount()).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(fake.jsonSyncCount()).toBeGreaterThan(1);
    expect((await fetch(`${baseUrl(app)}/api/status`)).status).toBe(200);
  });

  it("keeps serving the quests it has when a refresh fails", async () => {
    const { config } = setUp();
    let failing = false;
    const inner = config.fetchImpl as typeof fetch;
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      if (failing) throw new TypeError("offline");
      return inner(input, init);
    }) as typeof fetch;

    app = await startApp({ ...config, fetchImpl, refreshIntervalMs: 30 });
    const before = ((await (await fetch(`${baseUrl(app)}/api/tasks`)).json()) as { tasks: unknown[] }).tasks.length;
    failing = true;
    await new Promise((resolve) => setTimeout(resolve, 150));

    const after = ((await (await fetch(`${baseUrl(app)}/api/tasks`)).json()) as { tasks: unknown[] }).tasks.length;
    expect(after).toBe(before);
    expect(after).toBeGreaterThan(0);
  });

  it("keeps its saved progress in TARKOV_DATA_DIR when that is set, leaving the project folder alone", async () => {
    const { config } = setUp();
    const dataDir = join(tempDir!, "elsewhere");
    mkdirSync(dataDir);
    const { cachePath: _cache, dbPath: _db, ...withoutPaths } = config;
    const saved = process.env.TARKOV_DATA_DIR;
    process.env.TARKOV_DATA_DIR = dataDir;
    try {
      app = await startApp(withoutPaths);
    } finally {
      if (saved === undefined) delete process.env.TARKOV_DATA_DIR;
      else process.env.TARKOV_DATA_DIR = saved;
    }

    expect(existsSync(join(dataDir, ".tarkov-progress.sqlite"))).toBe(true);
    expect(existsSync(join(dataDir, ".tarkov-cache.json"))).toBe(true);
  });
});
