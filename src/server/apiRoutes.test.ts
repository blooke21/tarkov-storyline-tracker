import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
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
  });
  server = createServer({ apiRoutes: routes, staticDir: tempDir! });
}

describe("createApiRoutes integration", () => {
  it("serves /api/status over HTTP", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    store = new ProgressStore(":memory:");
    startTestServer();
    await new Promise<void>((resolve) => server!.listen(0, resolve));

    const response = await fetch(`${baseUrl()}/api/status`);
    const body = (await response.json()) as { taskGraphFetchedAt: null };

    expect(response.status).toBe(200);
    expect(body.taskGraphFetchedAt).toBeNull();
  });

  it("serves /api/progress over HTTP, including overall progress", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    store = new ProgressStore(":memory:");
    startTestServer();
    await new Promise<void>((resolve) => server!.listen(0, resolve));

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
    await new Promise<void>((resolve) => server!.listen(0, resolve));

    const response = await fetch(`${baseUrl()}/api/tasks?storyline=kappa`);
    const body = (await response.json()) as { tasks: Array<{ id: string; status: string | null }> };

    expect(response.status).toBe(200);
    expect(body.tasks.map((t) => t.id).sort()).toEqual(["sample-1", "sample-3"]);
    expect(body.tasks.find((t) => t.id === "sample-1")?.status).toBe("completed");
  });
});
