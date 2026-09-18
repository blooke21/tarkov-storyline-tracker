import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { startApp } from "./app.js";
import { sampleTasks } from "./tarkovData/__fixtures__/sampleTasks.js";

let tempDir: string | undefined;
let app: Awaited<ReturnType<typeof startApp>> | undefined;

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
});

describe("startApp", () => {
  it("wires fetch -> cache -> backfill -> server into a working local app", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-app-test-"));
    const staticDir = join(tempDir, "public");
    mkdirSync(staticDir);
    writeFileSync(join(staticDir, "index.html"), "<h1>ok</h1>");
    const logsRootDir = join(tempDir, "logs");
    mkdirSync(logsRootDir);

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { tasks: sampleTasks } }),
    });

    app = await startApp({
      port: 0,
      logsRootDir,
      cachePath: join(tempDir, "cache.json"),
      dbPath: join(tempDir, "progress.sqlite"),
      staticDir,
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });

    const port = (app.server.address() as AddressInfo).port;

    const progressResponse = await fetch(`http://127.0.0.1:${port}/api/progress`);
    const progressBody = (await progressResponse.json()) as { storylines: unknown[] };
    expect(progressResponse.status).toBe(200);
    expect(progressBody.storylines.length).toBeGreaterThan(0);

    const indexResponse = await fetch(`http://127.0.0.1:${port}/`);
    expect(await indexResponse.text()).toBe("<h1>ok</h1>");

    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });
});
