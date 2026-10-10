import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createServer } from "./createServer.js";
import { createApiRoutes } from "./apiRoutes.js";
import { ProgressStore } from "../progress/store.js";
import { deriveStorylines } from "../storylines/deriveStorylines.js";
import { sampleTasks } from "../tarkovData/__fixtures__/sampleTasks.js";

let server: Server | undefined;
let store: ProgressStore | undefined;
let tempDir: string | undefined;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
  store?.close();
  store = undefined;
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

function baseUrl(): string {
  const port = (server!.address() as AddressInfo).port;
  return `http://localhost:${port}`;
}

function startTestServer(): void {
  const storylines = deriveStorylines(sampleTasks);
  const routes = createApiRoutes({
    store: store!,
    getCache: () => null,
    getTasks: () => sampleTasks,
    getStorylines: () => storylines,
    logsRootDir: join(tempDir!, "logs"),
  });
  server = createServer({ apiRoutes: routes, staticDir: tempDir! });
}

/** One real-format quest event (task "sample-1" completed) in a fake logs folder. */
function writeLogWithEvent(dt: number, type: number, taskId = "sample-1"): void {
  const dir = join(tempDir!, "logs", "log_2026.09.16_13-19-26_1.1.5.0.47426");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "2026.09.16_13-19-26_1.1.5.0.47426 push-notifications_000.log"),
    [
      "2026-09-16 13:20:00.000|1.1.5.0.47426|Info|push-notifications|Got notification | ChatMessageReceived",
      "{",
      `  "message": { "type": ${type}, "dt": ${dt}, "templateId": "${taskId} description" }`,
      "}",
    ].join("\n")
  );
}

const TRACKER_HEADER = { "X-Requested-With": "tarkov-tracker" };

describe("createApiRoutes integration", () => {
  it("serves /api/status over HTTP", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    store = new ProgressStore(":memory:");
    startTestServer();
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));

    const response = await fetch(`${baseUrl()}/api/status`);
    const body = (await response.json()) as { taskGraphFetchedAt: null };

    expect(response.status).toBe(200);
    expect(body.taskGraphFetchedAt).toBeNull();
  });

  it("serves /api/progress over HTTP, including overall progress", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    store = new ProgressStore(":memory:");
    startTestServer();
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));

    const response = await fetch(`${baseUrl()}/api/progress`);
    const body = (await response.json()) as { overall: { totalTasks: number }; storylines: Array<{ id: string }> };

    expect(response.status).toBe(200);
    expect(body.overall.totalTasks).toBe(4);
    expect(body.storylines.map((s) => s.id)).toContain("kappa");
  });

  it("serves /api/tasks over HTTP, applying query-string filters", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    store = new ProgressStore(":memory:");
    store.recordEvent("sample-1", "completed");
    startTestServer();
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));

    const response = await fetch(`${baseUrl()}/api/tasks?storyline=kappa`);
    const body = (await response.json()) as { tasks: Array<{ id: string; status: string | null }> };

    expect(response.status).toBe(200);
    expect(body.tasks.map((t) => t.id).sort()).toEqual(["sample-1", "sample-3"]);
    expect(body.tasks.find((t) => t.id === "sample-1")?.status).toBe("completed");
  });
});

describe("wipe routes over HTTP", () => {
  // A moment in the past (Oct 2025): the server rejects a "since" in the future.
  const T = 1760000000;

  async function boot(): Promise<void> {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    store = new ProgressStore(":memory:");
    writeLogWithEvent(T, 12);
    startTestServer();
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  }

  it("GET /api/wipe/options lists recent quest actions from the logs, with names", async () => {
    await boot();

    const body = (await (await fetch(`${baseUrl()}/api/wipe/options`)).json()) as {
      recentEvents: Array<{ name: string; status: string }>;
    };

    expect(body.recentEvents).toEqual([expect.objectContaining({ name: "Debut", status: "completed" })]);
  });

  it("GET /api/wipe/preview shows the effect without changing anything", async () => {
    await boot();
    store!.recordEvent("sample-1", "completed", new Date(T * 1000));

    const response = await fetch(`${baseUrl()}/api/wipe/preview?since=${new Date(T * 1000).toISOString()}`);
    const body = (await response.json()) as { willClear: { completed: number }; keptEvents: number };

    expect(response.status).toBe(200);
    expect(body.willClear.completed).toBe(1);
    expect(body.keptEvents).toBe(1);
    expect(store!.getStatus("sample-1")).toBe("completed");
    expect(store!.getProgressSince()).toBeNull();
  });

  it("rejects a preview with a bad since as a 400", async () => {
    await boot();

    expect((await fetch(`${baseUrl()}/api/wipe/preview?since=nonsense`)).status).toBe(400);
    expect((await fetch(`${baseUrl()}/api/wipe/preview`)).status).toBe(400);
  });

  it("refuses POST /api/wipe without the tracker header, and changes nothing", async () => {
    await boot();
    store!.recordEvent("sample-1", "completed", new Date(T * 1000));

    const response = await fetch(`${baseUrl()}/api/wipe?since=${new Date((T + 10) * 1000).toISOString()}`, {
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(store!.getStatus("sample-1")).toBe("completed");
    expect(store!.getProgressSince()).toBeNull();
  });

  it("POST /api/wipe with the header wipes, keeps events from the boundary on, and remembers it", async () => {
    await boot();
    store!.recordEvent("sample-9", "completed", new Date((T - 500) * 1000));

    const response = await fetch(`${baseUrl()}/api/wipe?since=${new Date(T * 1000).toISOString()}`, {
      method: "POST",
      headers: TRACKER_HEADER,
    });
    const body = (await response.json()) as { since: string; picked: number };

    expect(response.status).toBe(200);
    expect(body.picked).toBe(1);
    expect(store!.getStatus("sample-9")).toBeNull();
    expect(store!.getStatus("sample-1")).toBe("completed");
    expect(store!.getProgressSince()).toEqual(new Date(T * 1000));
  });

  it("is not reachable with GET (a state change must be a POST)", async () => {
    await boot();

    const response = await fetch(`${baseUrl()}/api/wipe?since=${new Date(T * 1000).toISOString()}`);

    expect(response.status).toBe(404);
    expect(store!.getProgressSince()).toBeNull();
  });
});

describe("story chapter routes over HTTP", () => {
  async function boot(): Promise<void> {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    store = new ProgressStore(":memory:");
    startTestServer();
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  }

  type Chapters = { chapters: Array<{ id: string; status: string; objectives: Array<{ done: boolean }> }> };

  it("GET /api/chapters lists the built-in chapters, Tour first", async () => {
    await boot();

    const body = (await (await fetch(`${baseUrl()}/api/chapters`)).json()) as Chapters;

    expect(body.chapters.map((c) => c.id).slice(0, 2)).toEqual(["tour", "falling-skies"]);
    expect(body.chapters.every((c) => c.status === "not-started")).toBe(true);
  });

  it("refuses to change anything without the tracker header", async () => {
    await boot();

    const status = await fetch(`${baseUrl()}/api/chapters/status?chapter=tour&status=active`, { method: "POST" });
    const objective = await fetch(`${baseUrl()}/api/chapters/objective?chapter=tour&index=0&done=1`, { method: "POST" });

    expect(status.status).toBe(403);
    expect(objective.status).toBe(403);
    const body = (await (await fetch(`${baseUrl()}/api/chapters`)).json()) as Chapters;
    expect(body.chapters.find((c) => c.id === "tour")?.status).toBe("not-started");
  });

  it("marks a chapter active and ticks a step, returning the updated chapters", async () => {
    await boot();

    await fetch(`${baseUrl()}/api/chapters/status?chapter=falling-skies&status=active`, { method: "POST", headers: TRACKER_HEADER });
    const response = await fetch(`${baseUrl()}/api/chapters/objective?chapter=tour&index=0&done=1`, {
      method: "POST",
      headers: TRACKER_HEADER,
    });
    const body = (await response.json()) as Chapters;

    expect(response.status).toBe(200);
    expect(body.chapters.find((c) => c.id === "falling-skies")?.status).toBe("active");
    expect(body.chapters.find((c) => c.id === "tour")?.objectives[0].done).toBe(true);
  });

  it("answers a bad chapter with 404 and a bad status with 400", async () => {
    await boot();

    const unknown = await fetch(`${baseUrl()}/api/chapters/status?chapter=nope&status=active`, { method: "POST", headers: TRACKER_HEADER });
    const badStatus = await fetch(`${baseUrl()}/api/chapters/status?chapter=tour&status=sideways`, { method: "POST", headers: TRACKER_HEADER });

    expect(unknown.status).toBe(404);
    expect(badStatus.status).toBe(400);
  });
});

describe("scan route over HTTP", () => {
  async function boot(): Promise<void> {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    store = new ProgressStore(":memory:");
    writeLogWithEvent(1760000000, 12);
    startTestServer();
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  }

  it("refuses POST /api/scan without the tracker header", async () => {
    await boot();

    const response = await fetch(`${baseUrl()}/api/scan`, { method: "POST" });

    expect(response.status).toBe(403);
    expect(store!.getStatus("sample-1")).toBeNull();
  });

  it("scans the logs, brings the tracker up to date and reports what it did", async () => {
    await boot();

    const response = await fetch(`${baseUrl()}/api/scan`, { method: "POST", headers: TRACKER_HEADER });
    const body = (await response.json()) as { eventsInLogs: number; added: number; tracked: { completed: number } };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ eventsInLogs: 1, added: 1, tracked: { completed: 1 } });
    expect(store!.getStatus("sample-1")).toBe("completed");
  });
});

describe("chapter position route over HTTP", () => {
  it("needs the tracker header, then ticks everything before the chosen step", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    store = new ProgressStore(":memory:");
    startTestServer();
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const url = `${baseUrl()}/api/chapters/position?chapter=tour&index=3`;

    expect((await fetch(url, { method: "POST" })).status).toBe(403);

    const response = await fetch(url, { method: "POST", headers: TRACKER_HEADER });
    const body = (await response.json()) as { chapters: Array<{ id: string; status: string; objectives: Array<{ done: boolean }> }> };
    const tour = body.chapters.find((c) => c.id === "tour")!;

    expect(response.status).toBe(200);
    expect(tour.status).toBe("active");
    expect(tour.objectives.slice(0, 4).map((o) => o.done)).toEqual([true, true, true, false]);
  });
});

describe("pin route over HTTP", () => {
  it("needs the tracker header, then pins and unpins, and shows up in /api/tasks", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    store = new ProgressStore(":memory:");
    startTestServer();
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const pin = (flag: number, headers?: Record<string, string>) =>
      fetch(`${baseUrl()}/api/pins?task=sample-1&pinned=${flag}`, { method: "POST", headers });

    expect((await pin(1)).status).toBe(403);

    const pinned = (await (await pin(1, TRACKER_HEADER)).json()) as { pinned: string[] };
    expect(pinned.pinned).toEqual(["sample-1"]);
    const tasks = (await (await fetch(`${baseUrl()}/api/tasks`)).json()) as { tasks: Array<{ id: string; pinned: boolean }> };
    expect(tasks.tasks.find((t) => t.id === "sample-1")?.pinned).toBe(true);

    expect(((await (await pin(0, TRACKER_HEADER)).json()) as { pinned: string[] }).pinned).toEqual([]);
    const missing = await fetch(`${baseUrl()}/api/pins?task=nope&pinned=1`, { method: "POST", headers: TRACKER_HEADER });
    expect(missing.status).toBe(404);
  });
});

describe("prestige routes over HTTP", () => {
  it("serves the requirements, and changes the level only with the tracker header", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    store = new ProgressStore(":memory:");
    const routes = createApiRoutes({
      store,
      getCache: () => null,
      getTasks: () => sampleTasks,
      getStorylines: () => [],
      logsRootDir: join(tempDir, "logs"),
      getPrestige: () => [{ level: 1, conditions: [{ id: "c1", kind: "playerLevel", level: 15 }] }],
    });
    server = createServer({ apiRoutes: routes, staticDir: tempDir });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));

    const first = (await (await fetch(`${baseUrl()}/api/prestige`)).json()) as { available: boolean; next: { level: number } | null };
    expect(first).toMatchObject({ available: true, next: { level: 1 } });

    expect((await fetch(`${baseUrl()}/api/prestige/level?level=1`, { method: "POST" })).status).toBe(403);

    const moved = (await (
      await fetch(`${baseUrl()}/api/prestige/level?level=1`, { method: "POST", headers: TRACKER_HEADER })
    ).json()) as { current: number; next: unknown };
    expect(moved).toMatchObject({ current: 1, next: null });
    expect((await fetch(`${baseUrl()}/api/prestige/level?level=9`, { method: "POST", headers: TRACKER_HEADER })).status).toBe(400);
  });

  it("says the requirements are unavailable when none were loaded", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    store = new ProgressStore(":memory:");
    startTestServer();
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));

    const body = (await (await fetch(`${baseUrl()}/api/prestige`)).json()) as { available: boolean };

    expect(body.available).toBe(false);
  });
});
