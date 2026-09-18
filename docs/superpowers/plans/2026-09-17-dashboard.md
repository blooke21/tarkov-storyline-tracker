# Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the local web dashboard: an HTTP server exposing quest-progress data as JSON, a browser-based UI rendering storyline progress and filterable quest cards, and a single entry point that wires Plans 1 and 2's already-built pieces (tarkov.dev sync, storyline deriver, progress store, log backfill/live-tail) into one running local app.

**Architecture:** A small Node HTTP server (built on `node:http`, no framework — the route surface is three JSON endpoints plus static file serving) sits in front of a static, framework-free HTML/CSS/vanilla-JS dashboard. The server's data-shaping logic is pure and unit-tested separately from the HTTP plumbing. One entry point (`src/app.ts`) composes everything from Plans 1-2 with the server into a single running process, bound to `127.0.0.1` only (never the network) since this is explicitly a local-only tool.

**Tech Stack:** Node.js >= 20, TypeScript (strict mode, ESM/NodeNext), Vitest. No new dependencies — `node:http`/`node:fs/promises` for the server, vanilla JS/CSS/HTML for the frontend (no bundler, no framework), consistent with Plans 1-2's dependency discipline.

**Spec:** `docs/superpowers/specs/2026-09-16-tarkov-storyline-tracker-design.md`

## Global Constraints

- No cloud backend, no accounts, no data leaving the machine (spec: local-only architecture). This plan adds the one place where that matters most operationally: **the HTTP server must bind to `127.0.0.1` only, never `0.0.0.0` or all interfaces** — this is a local dashboard over the user's own quest progress, not something to expose on the network.
- TypeScript strict mode throughout (the `src/` tree only — `public/`'s static HTML/CSS/JS is plain browser code, not compiled, and is intentionally outside `tsconfig.json`'s `include`).
- No new npm dependencies. Use `node:http` directly rather than Express/Fastify/etc. — the route surface is three endpoints plus static file serving, which doesn't justify a framework.
- Reuse Plan 1/2's already-exported public surface from `src/index.ts` rather than deep-importing individual modules, except within `src/server/*` and `src/app.ts` themselves where a direct import is more natural for a file that IS part of that surface.
- The dashboard reads data through the API only — it does not talk to tarkov.dev or read the SQLite file directly. This keeps the browser code trivial and keeps "what data exists" defined in exactly one place (the API layer).

---

### Task 1: HTTP server core

**Files:**
- Create: `src/server/createServer.ts`
- Test: `src/server/createServer.test.ts`

**Interfaces:**
- Consumes: nothing from earlier plans (pure HTTP plumbing).
- Produces:
  - `ApiHandler` type: `(url: URL) => Promise<unknown> | unknown` — a route handler that returns a JSON-serializable value, or throws (optionally with a `.status` property) to produce an error response.
  - `ServerOptions` interface `{ apiRoutes: Record<string, ApiHandler>; staticDir: string }` — `apiRoutes` keys look like `"GET /api/progress"`.
  - `createServer(options: ServerOptions): http.Server` from `src/server/createServer.ts`. Does not call `.listen()` — that's the caller's job (Task 5), since binding host/port is an app-level decision, not this module's.

**Design note:** static file serving decodes the URL path and resolves it against `staticDir` using `path.resolve`, then verifies the resolved path is still inside `staticDir` before reading it — this blocks a percent-encoded traversal attempt (`%2e%2e%2f`) that would otherwise survive to the server undecoded (a plain `fetch("/../../etc/passwd")` never reaches this code at all, since the URL parser normalizes literal `..` before the request is even sent — the encoded form is what actually needs guarding against).

- [ ] **Step 1: Write the failing test**

Create `src/server/createServer.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createServer } from "./createServer.js";

let server: Server | undefined;
let tempDir: string | undefined;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

function baseUrl(): string {
  const port = (server!.address() as AddressInfo).port;
  return `http://localhost:${port}`;
}

describe("createServer", () => {
  it("serves the index file for the root path", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    writeFileSync(join(tempDir, "index.html"), "<h1>Hello</h1>");
    server = createServer({ apiRoutes: {}, staticDir: tempDir });
    await new Promise<void>((resolve) => server!.listen(0, resolve));

    const response = await fetch(`${baseUrl()}/`);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(text).toBe("<h1>Hello</h1>");
  });

  it("serves a nested static file by path with the right content type", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    writeFileSync(join(tempDir, "styles.css"), "body { color: red; }");
    server = createServer({ apiRoutes: {}, staticDir: tempDir });
    await new Promise<void>((resolve) => server!.listen(0, resolve));

    const response = await fetch(`${baseUrl()}/styles.css`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/css");
  });

  it("returns 404 for a missing static file", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    server = createServer({ apiRoutes: {}, staticDir: tempDir });
    await new Promise<void>((resolve) => server!.listen(0, resolve));

    const response = await fetch(`${baseUrl()}/does-not-exist.html`);

    expect(response.status).toBe(404);
  });

  it("blocks a percent-encoded path-traversal attempt outside the static directory", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    server = createServer({ apiRoutes: {}, staticDir: tempDir });
    await new Promise<void>((resolve) => server!.listen(0, resolve));

    // Percent-encoded so it survives to the server undecoded, the way a
    // crafted request (not a normal browser navigation, which a URL parser
    // would already have normalized) would reach it.
    const response = await fetch(`${baseUrl()}/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd`);

    expect([403, 404]).toContain(response.status);
  });

  it("routes a GET request to a matching API handler and returns JSON", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    server = createServer({
      apiRoutes: { "GET /api/hello": () => ({ message: "hi" }) },
      staticDir: tempDir,
    });
    await new Promise<void>((resolve) => server!.listen(0, resolve));

    const response = await fetch(`${baseUrl()}/api/hello`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ message: "hi" });
  });

  it("returns the handler's status code and message when an API handler throws", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    server = createServer({
      apiRoutes: {
        "GET /api/broken": () => {
          const error = new Error("nope") as Error & { status?: number };
          error.status = 400;
          throw error;
        },
      },
      staticDir: tempDir,
    });
    await new Promise<void>((resolve) => server!.listen(0, resolve));

    const response = await fetch(`${baseUrl()}/api/broken`);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("nope");
  });

  it("defaults to a 500 status when a thrown error has no status", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    server = createServer({
      apiRoutes: {
        "GET /api/crash": () => {
          throw new Error("boom");
        },
      },
      staticDir: tempDir,
    });
    await new Promise<void>((resolve) => server!.listen(0, resolve));

    const response = await fetch(`${baseUrl()}/api/crash`);

    expect(response.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/createServer.test.ts`
Expected: FAIL — `Cannot find module './createServer.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/server/createServer.ts`:

```ts
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

export type ApiHandler = (url: URL) => Promise<unknown> | unknown;

export interface ServerOptions {
  apiRoutes: Record<string, ApiHandler>;
  staticDir: string;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export function createServer(options: ServerOptions): Server {
  return createHttpServer((req, res) => {
    void handleRequest(req, res, options);
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, options: ServerOptions): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const routeKey = `${req.method} ${url.pathname}`;
  const handler = options.apiRoutes[routeKey];

  if (handler) {
    try {
      const body = await handler(url);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(body));
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500;
      const message = error instanceof Error ? error.message : "Internal error";
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: message }));
    }
    return;
  }

  await serveStatic(options.staticDir, url.pathname, res);
}

async function serveStatic(staticDir: string, pathname: string, res: ServerResponse): Promise<void> {
  const decodedPath = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  const resolvedStaticDir = resolve(staticDir);
  const filePath = resolve(resolvedStaticDir, `.${decodedPath}`);

  if (filePath !== resolvedStaticDir && !filePath.startsWith(resolvedStaticDir + sep)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/server/createServer.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/server/createServer.ts src/server/createServer.test.ts
git commit -m "Add local HTTP server core (static files + JSON API routing)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: API data-shaping functions

**Files:**
- Create: `src/server/apiData.ts`
- Test: `src/server/apiData.test.ts`

**Interfaces:**
- Consumes: `TarkovTask` from `src/tarkovData/types.js`; `TaskCache` from `src/tarkovData/cache.js`; `Storyline` from `src/storylines/deriveStorylines.js`; `ProgressStore`, `TaskStatus` from `src/progress/store.js`; `sampleTasks` fixture from `src/tarkovData/__fixtures__/sampleTasks.js` (Plan 1, used only in this task's tests).
- Produces:
  - `StatusResponse { taskGraphFetchedAt: string | null; lastRaidSeenAt: string | null; lastWatcherPollAt: string | null }` and `buildStatusResponse(cache: TaskCache | null, store: ProgressStore): StatusResponse`.
  - `StorylineProgress { id: string; name: string; totalTasks: number; completedTasks: number }`, `ProgressResponse { overall: { totalTasks: number; completedTasks: number }; storylines: StorylineProgress[] }`, and `buildProgressResponse(tasks: TarkovTask[], storylines: Storyline[], store: ProgressStore): ProgressResponse`. `overall` is computed from the full task list, not summed from `storylines`, because storylines overlap (a task can belong to more than one) — summing would double-count. The spec calls for "overall progress" as its own top-level metric distinct from the per-storyline bars, so this can't be derived from `storylines` alone.
  - `TaskResponseItem { id, name, trader: string, map: string | null, wikiLink: string | null, status: TaskStatus | null, actionable: boolean, objectives: Array<{description: string; optional: boolean}>, storylineIds: string[] }`, `TasksResponse { tasks: TaskResponseItem[] }`, `TasksFilter { storyline?: string; trader?: string; map?: string }`, and `buildTasksResponse(tasks: TarkovTask[], storylines: Storyline[], store: ProgressStore, filter?: TasksFilter): TasksResponse`.

All from `src/server/apiData.ts`. These are pure functions — no HTTP, no filesystem — so Task 3 can wire them into routes and this task can test them directly with a seeded `ProgressStore` and task fixtures.

**Design note — "actionable":** a task is actionable ("next up") if it isn't already completed and every one of its `taskRequirements` that demands `"complete"` status is satisfied. A requirement demanding some other status (rare, but the schema allows it) is treated as already satisfied for this purpose — v1 only tracks accepted/completed/failed, so there's nothing meaningful to check it against yet.

- [ ] **Step 1: Write the failing test**

Create `src/server/apiData.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { ProgressStore } from "../progress/store.js";
import { deriveStorylines } from "../storylines/deriveStorylines.js";
import { sampleTasks } from "../tarkovData/__fixtures__/sampleTasks.js";
import { buildStatusResponse, buildProgressResponse, buildTasksResponse } from "./apiData.js";
import type { TaskCache } from "../tarkovData/cache.js";

let store: ProgressStore | undefined;

afterEach(() => {
  store?.close();
  store = undefined;
});

describe("buildStatusResponse", () => {
  it("defaults every field to null when nothing has been set", () => {
    store = new ProgressStore(":memory:");
    expect(buildStatusResponse(null, store)).toEqual({
      taskGraphFetchedAt: null,
      lastRaidSeenAt: null,
      lastWatcherPollAt: null,
    });
  });

  it("returns the cache's fetchedAt and the store's meta values when set", () => {
    store = new ProgressStore(":memory:");
    store.setMeta("lastRaidSeenAt", "2026-01-01T00:00:00.000Z");
    store.setMeta("lastWatcherPollAt", "2026-01-02T00:00:00.000Z");
    const cache: TaskCache = { version: 1, fetchedAt: "2026-01-03T00:00:00.000Z", tasks: [] };

    expect(buildStatusResponse(cache, store)).toEqual({
      taskGraphFetchedAt: "2026-01-03T00:00:00.000Z",
      lastRaidSeenAt: "2026-01-01T00:00:00.000Z",
      lastWatcherPollAt: "2026-01-02T00:00:00.000Z",
    });
  });
});

describe("buildProgressResponse", () => {
  it("computes total and completed task counts per storyline", () => {
    store = new ProgressStore(":memory:");
    store.recordEvent("sample-1", "completed");
    const storylines = deriveStorylines(sampleTasks);

    const response = buildProgressResponse(sampleTasks, storylines, store);

    const kappa = response.storylines.find((s) => s.id === "kappa");
    expect(kappa).toEqual({ id: "kappa", name: "Path to Kappa", totalTasks: 2, completedTasks: 1 });
  });

  it("computes overall progress from the full task list, not summed from storylines", () => {
    store = new ProgressStore(":memory:");
    store.recordEvent("sample-1", "completed");
    store.recordEvent("sample-3", "completed");
    const storylines = deriveStorylines(sampleTasks);

    const response = buildProgressResponse(sampleTasks, storylines, store);

    // sampleTasks has 4 tasks total; sample-1 and sample-3 are both
    // kappa-required (they'd double-count if overall were summed from
    // storylines instead of computed from the task list directly).
    expect(response.overall).toEqual({ totalTasks: 4, completedTasks: 2 });
  });
});

describe("buildTasksResponse", () => {
  it("returns every task with status, storyline membership, and objectives when no filter is given", () => {
    store = new ProgressStore(":memory:");
    const storylines = deriveStorylines(sampleTasks);

    const response = buildTasksResponse(sampleTasks, storylines, store);

    expect(response.tasks).toHaveLength(4);
    const sample1 = response.tasks.find((t) => t.id === "sample-1");
    expect(sample1?.status).toBeNull();
    expect(sample1?.wikiLink).toBe("https://escapefromtarkov.fandom.com/wiki/Debut");
    expect(sample1?.objectives).toEqual([
      { description: "Successfully extract from the location", optional: false },
    ]);
    expect(sample1?.storylineIds).toContain("kappa");
  });

  it("marks a task not actionable while its prerequisite is incomplete", () => {
    store = new ProgressStore(":memory:");
    const storylines = deriveStorylines(sampleTasks);

    const response = buildTasksResponse(sampleTasks, storylines, store);

    const sample2 = response.tasks.find((t) => t.id === "sample-2");
    expect(sample2?.actionable).toBe(false);
  });

  it("marks a task actionable once its prerequisite is completed", () => {
    store = new ProgressStore(":memory:");
    store.recordEvent("sample-1", "completed");
    const storylines = deriveStorylines(sampleTasks);

    const response = buildTasksResponse(sampleTasks, storylines, store);

    const sample2 = response.tasks.find((t) => t.id === "sample-2");
    expect(sample2?.actionable).toBe(true);
  });

  it("never marks an already-completed task as actionable", () => {
    store = new ProgressStore(":memory:");
    store.recordEvent("sample-1", "completed");
    const storylines = deriveStorylines(sampleTasks);

    const response = buildTasksResponse(sampleTasks, storylines, store);

    const sample1 = response.tasks.find((t) => t.id === "sample-1");
    expect(sample1?.actionable).toBe(false);
  });

  it("filters by trader", () => {
    store = new ProgressStore(":memory:");
    const storylines = deriveStorylines(sampleTasks);

    const response = buildTasksResponse(sampleTasks, storylines, store, { trader: "Prapor" });

    expect(response.tasks.map((t) => t.id).sort()).toEqual(["sample-1", "sample-3"]);
  });

  it("filters by map", () => {
    store = new ProgressStore(":memory:");
    const storylines = deriveStorylines(sampleTasks);

    const response = buildTasksResponse(sampleTasks, storylines, store, { map: "Customs" });

    expect(response.tasks.map((t) => t.id)).toEqual(["sample-3"]);
  });

  it("filters by storyline", () => {
    store = new ProgressStore(":memory:");
    const storylines = deriveStorylines(sampleTasks);

    const response = buildTasksResponse(sampleTasks, storylines, store, { storyline: "bear" });

    expect(response.tasks.map((t) => t.id)).toEqual(["sample-4"]);
  });

  it("combines filters", () => {
    store = new ProgressStore(":memory:");
    const storylines = deriveStorylines(sampleTasks);

    const response = buildTasksResponse(sampleTasks, storylines, store, { storyline: "kappa", trader: "Prapor" });

    expect(response.tasks.map((t) => t.id).sort()).toEqual(["sample-1", "sample-3"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/apiData.test.ts`
Expected: FAIL — `Cannot find module './apiData.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/server/apiData.ts`:

```ts
import type { TarkovTask } from "../tarkovData/types.js";
import type { TaskCache } from "../tarkovData/cache.js";
import type { Storyline } from "../storylines/deriveStorylines.js";
import type { ProgressStore, TaskStatus } from "../progress/store.js";

export interface StatusResponse {
  taskGraphFetchedAt: string | null;
  lastRaidSeenAt: string | null;
  lastWatcherPollAt: string | null;
}

export function buildStatusResponse(cache: TaskCache | null, store: ProgressStore): StatusResponse {
  return {
    taskGraphFetchedAt: cache?.fetchedAt ?? null,
    lastRaidSeenAt: store.getMeta("lastRaidSeenAt"),
    lastWatcherPollAt: store.getMeta("lastWatcherPollAt"),
  };
}

export interface StorylineProgress {
  id: string;
  name: string;
  totalTasks: number;
  completedTasks: number;
}

export interface ProgressResponse {
  overall: { totalTasks: number; completedTasks: number };
  storylines: StorylineProgress[];
}

export function buildProgressResponse(
  tasks: TarkovTask[],
  storylines: Storyline[],
  store: ProgressStore
): ProgressResponse {
  const statuses = store.getAllStatuses();
  return {
    overall: {
      totalTasks: tasks.length,
      completedTasks: tasks.filter((task) => statuses.get(task.id) === "completed").length,
    },
    storylines: storylines.map((storyline) => ({
      id: storyline.id,
      name: storyline.name,
      totalTasks: storyline.taskIds.length,
      completedTasks: storyline.taskIds.filter((id) => statuses.get(id) === "completed").length,
    })),
  };
}

export interface TaskResponseItem {
  id: string;
  name: string;
  trader: string;
  map: string | null;
  wikiLink: string | null;
  status: TaskStatus | null;
  actionable: boolean;
  objectives: Array<{ description: string; optional: boolean }>;
  storylineIds: string[];
}

export interface TasksResponse {
  tasks: TaskResponseItem[];
}

export interface TasksFilter {
  storyline?: string;
  trader?: string;
  map?: string;
}

function isActionable(task: TarkovTask, statuses: Map<string, TaskStatus>): boolean {
  if (statuses.get(task.id) === "completed") {
    return false;
  }
  return task.taskRequirements.every((requirement) => {
    if (!requirement.status.includes("complete")) {
      return true;
    }
    return statuses.get(requirement.task.id) === "completed";
  });
}

export function buildTasksResponse(
  tasks: TarkovTask[],
  storylines: Storyline[],
  store: ProgressStore,
  filter: TasksFilter = {}
): TasksResponse {
  const statuses = store.getAllStatuses();
  const storylinesByTaskId = new Map<string, string[]>();
  for (const storyline of storylines) {
    for (const taskId of storyline.taskIds) {
      const list = storylinesByTaskId.get(taskId) ?? [];
      list.push(storyline.id);
      storylinesByTaskId.set(taskId, list);
    }
  }

  const items = tasks
    .filter((task) => !filter.trader || task.trader.name === filter.trader)
    .filter((task) => !filter.map || task.map?.name === filter.map)
    .filter((task) => !filter.storyline || (storylinesByTaskId.get(task.id) ?? []).includes(filter.storyline))
    .map((task) => ({
      id: task.id,
      name: task.name,
      trader: task.trader.name,
      map: task.map?.name ?? null,
      wikiLink: task.wikiLink,
      status: statuses.get(task.id) ?? null,
      actionable: isActionable(task, statuses),
      objectives: task.objectives.map((objective) => ({
        description: objective.description,
        optional: objective.optional,
      })),
      storylineIds: storylinesByTaskId.get(task.id) ?? [],
    }));

  return { tasks: items };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/server/apiData.test.ts`
Expected: PASS — all 12 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/server/apiData.ts src/server/apiData.test.ts
git commit -m "Add API data-shaping functions (status, progress, tasks with actionable flag)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Wire API routes and verify end-to-end over real HTTP

**Files:**
- Create: `src/server/apiRoutes.ts`
- Test: `src/server/apiRoutes.test.ts`

**Interfaces:**
- Consumes: `ApiHandler` from `src/server/createServer.js` (Task 1); `buildStatusResponse`, `buildProgressResponse`, `buildTasksResponse` from `src/server/apiData.js` (Task 2); `TarkovTask` from `src/tarkovData/types.js`; `TaskCache` from `src/tarkovData/cache.js`; `Storyline` from `src/storylines/deriveStorylines.js`; `ProgressStore` from `src/progress/store.js`.
- Produces: `ApiDeps { store: ProgressStore; getCache: () => TaskCache | null; getTasks: () => TarkovTask[]; getStorylines: () => Storyline[] }` and `createApiRoutes(deps: ApiDeps): Record<string, ApiHandler>` from `src/server/apiRoutes.ts`. This is the object Task 5's `app.ts` passes straight into `createServer`'s `apiRoutes` option.

- [ ] **Step 1: Write the failing test**

Create `src/server/apiRoutes.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/apiRoutes.test.ts`
Expected: FAIL — `Cannot find module './apiRoutes.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/server/apiRoutes.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/server/apiRoutes.test.ts`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/server/apiRoutes.ts src/server/apiRoutes.test.ts
git commit -m "Wire API data functions into HTTP routes, verified end-to-end

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Dashboard frontend

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `public/app.js`

**Interfaces:**
- Consumes: the three JSON endpoints from Task 3 (`GET /api/status`, `GET /api/progress`, `GET /api/tasks`) via `fetch` from the browser. No build step, no bundler — these files are served as-is by Task 1's static file handler.
- Produces: nothing consumed by later tasks (this is the leaf of the dependency graph — Task 5 only needs the *directory* to exist and point `staticDir` at it).

**No automated test for this task.** Static browser UI isn't unit-testable without adding a DOM-testing dependency (jsdom or similar), which Global Constraints rules out for this plan (no new dependencies) — the one exception the plan makes to its own TDD posture. Verification is manual: **Step 4 below is "open it in a browser and check it," not a command that produces a pass/fail** — do this after Task 5 wires the server up, since these files need real API responses to render anything meaningful. Come back to this task's Step 4 once Task 5 is done.

- [ ] **Step 1: Create `public/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Tarkov Storyline Tracker</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <header>
    <h1>Tarkov Storyline Tracker</h1>
    <p id="status-line" class="status-line">Loading...</p>
  </header>

  <main>
    <section id="overall-progress" class="storyline-card overall" aria-label="Overall progress"></section>

    <section id="storylines" aria-label="Storyline progress"></section>

    <section aria-label="Filters" class="filters">
      <label>
        Storyline
        <select id="filter-storyline"><option value="">All</option></select>
      </label>
      <label>
        Trader
        <select id="filter-trader"><option value="">All</option></select>
      </label>
      <label>
        Map
        <select id="filter-map"><option value="">All</option></select>
      </label>
      <label>
        <input type="checkbox" id="filter-actionable" />
        Next up only
      </label>
    </section>

    <section id="tasks" aria-label="Tasks"></section>
  </main>

  <script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `public/styles.css`**

```css
:root {
  color-scheme: dark;
  --bg: #0f1115;
  --card-bg: #1a1d24;
  --text: #e6e6e6;
  --muted: #9aa0a6;
  --accent: #6fae5c;
  --border: #2a2d35;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: system-ui, sans-serif;
  background: var(--bg);
  color: var(--text);
}

header {
  padding: 1.5rem;
  border-bottom: 1px solid var(--border);
}

header h1 {
  margin: 0 0 0.25rem;
  font-size: 1.5rem;
}

.status-line {
  margin: 0;
  color: var(--muted);
  font-size: 0.85rem;
}

main {
  padding: 1.5rem;
  max-width: 900px;
  margin: 0 auto;
}

#storylines {
  display: grid;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}

.storyline-card {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.75rem 1rem;
}

.storyline-card h3 {
  margin: 0 0 0.4rem;
  font-size: 1rem;
  font-weight: 600;
}

.storyline-card.overall {
  border-color: var(--accent);
  margin-bottom: 0.75rem;
}

.progress-bar {
  height: 8px;
  background: var(--border);
  border-radius: 4px;
  overflow: hidden;
}

.progress-bar > div {
  height: 100%;
  background: var(--accent);
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: center;
  margin-bottom: 1rem;
  font-size: 0.9rem;
}

.filters select {
  margin-left: 0.4rem;
}

#tasks {
  display: grid;
  gap: 0.75rem;
}

.task-card {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.75rem 1rem;
}

.task-card.completed {
  opacity: 0.55;
}

.task-card h4 {
  margin: 0 0 0.25rem;
  font-size: 1rem;
}

.task-meta {
  color: var(--muted);
  font-size: 0.8rem;
  margin-bottom: 0.4rem;
}

.task-card ul {
  margin: 0.4rem 0;
  padding-left: 1.2rem;
}

.task-card a {
  color: var(--accent);
}

.badge {
  display: inline-block;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-size: 0.7rem;
  margin-right: 0.3rem;
  background: var(--border);
}

.badge.actionable {
  background: var(--accent);
  color: #0f1115;
}
```

- [ ] **Step 3: Create `public/app.js`**

```js
const state = {
  tasks: [],
  storylines: [],
};

async function loadData() {
  const [statusRes, progressRes, tasksRes] = await Promise.all([
    fetch("/api/status"),
    fetch("/api/progress"),
    fetch("/api/tasks"),
  ]);
  const status = await statusRes.json();
  const progress = await progressRes.json();
  const tasksData = await tasksRes.json();

  state.storylines = progress.storylines;
  state.tasks = tasksData.tasks;

  renderStatus(status);
  renderOverall(progress.overall);
  renderStorylines(state.storylines);
  populateFilters(state.tasks);
  renderTasks();
}

function renderOverall(overall) {
  const percent = overall.totalTasks === 0 ? 0 : Math.round((overall.completedTasks / overall.totalTasks) * 100);
  const container = document.getElementById("overall-progress");
  container.innerHTML = `
    <h3>Overall Progress — ${overall.completedTasks}/${overall.totalTasks} (${percent}%)</h3>
    <div class="progress-bar"><div style="width: ${percent}%"></div></div>
  `;
}

function renderStatus(status) {
  const line = document.getElementById("status-line");
  const parts = [];
  parts.push(
    status.lastWatcherPollAt
      ? `Last synced: ${new Date(status.lastWatcherPollAt).toLocaleString()}`
      : "Watcher has not synced yet"
  );
  if (status.taskGraphFetchedAt) {
    parts.push(`Quest data updated: ${new Date(status.taskGraphFetchedAt).toLocaleDateString()}`);
  }
  line.textContent = parts.join(" \u2022 ");
}

function renderStorylines(storylines) {
  const container = document.getElementById("storylines");
  container.innerHTML = "";
  for (const storyline of storylines) {
    const percent =
      storyline.totalTasks === 0 ? 0 : Math.round((storyline.completedTasks / storyline.totalTasks) * 100);
    const card = document.createElement("div");
    card.className = "storyline-card";
    card.innerHTML = `
      <h3>${storyline.name} \u2014 ${storyline.completedTasks}/${storyline.totalTasks} (${percent}%)</h3>
      <div class="progress-bar"><div style="width: ${percent}%"></div></div>
    `;
    container.appendChild(card);
  }
}

function populateFilters(tasks) {
  fillSelect(
    "filter-storyline",
    dedupeByValue(state.storylines.map((s) => ({ value: s.id, label: s.name })))
  );
  fillSelect(
    "filter-trader",
    dedupeByValue(tasks.map((t) => ({ value: t.trader, label: t.trader })))
  );
  fillSelect(
    "filter-map",
    dedupeByValue(tasks.filter((t) => t.map).map((t) => ({ value: t.map, label: t.map })))
  );
}

function dedupeByValue(options) {
  const seen = new Map();
  for (const option of options) {
    seen.set(option.value, option);
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function fillSelect(id, options) {
  const select = document.getElementById(id);
  const current = select.value;
  select.innerHTML = '<option value="">All</option>';
  for (const option of options) {
    const el = document.createElement("option");
    el.value = option.value;
    el.textContent = option.label;
    select.appendChild(el);
  }
  select.value = current;
}

function renderTasks() {
  const storylineFilter = document.getElementById("filter-storyline").value;
  const traderFilter = document.getElementById("filter-trader").value;
  const mapFilter = document.getElementById("filter-map").value;
  const actionableOnly = document.getElementById("filter-actionable").checked;

  const filtered = state.tasks.filter((task) => {
    if (storylineFilter && !task.storylineIds.includes(storylineFilter)) return false;
    if (traderFilter && task.trader !== traderFilter) return false;
    if (mapFilter && task.map !== mapFilter) return false;
    if (actionableOnly && !(task.actionable && task.status !== "completed")) return false;
    return true;
  });

  const container = document.getElementById("tasks");
  container.innerHTML = "";
  for (const task of filtered) {
    const card = document.createElement("div");
    card.className = "task-card" + (task.status === "completed" ? " completed" : "");
    const badges = [];
    if (task.actionable && task.status !== "completed") {
      badges.push('<span class="badge actionable">Next up</span>');
    }
    if (task.status) {
      badges.push(`<span class="badge">${task.status}</span>`);
    }
    const objectives = task.objectives
      .map((o) => `<li>${o.description}${o.optional ? " (optional)" : ""}</li>`)
      .join("");
    const wiki = task.wikiLink
      ? `<a href="${task.wikiLink}" target="_blank" rel="noopener">View on wiki</a>`
      : "";
    card.innerHTML = `
      <h4>${task.name}</h4>
      <div class="task-meta">${badges.join(" ")} ${task.trader}${task.map ? " \u2022 " + task.map : ""}</div>
      <ul>${objectives}</ul>
      ${wiki}
    `;
    container.appendChild(card);
  }
}

for (const id of ["filter-storyline", "filter-trader", "filter-map", "filter-actionable"]) {
  document.getElementById(id).addEventListener("change", renderTasks);
}

loadData();
```

- [ ] **Step 4: Manual verification (do this after Task 5 is complete)**

Run: `npm run build && node dist/app.js` (or whatever Task 5's start command ends up being — see that task), then open `http://localhost:4173` (or the configured port) in a browser. Confirm:
- The page loads without console errors.
- An overall progress bar renders above the per-storyline cards.
- Storyline cards show progress bars.
- The task list renders, and each of the three filter dropdowns actually narrows the list.
- Clicking "View on wiki" on a task opens the correct Fandom page in a new tab.
- Toggling "Next up only" hides completed and not-yet-actionable tasks.

There is nothing to commit as a result of this step alone — commit the three files from Steps 1-3 now, and treat Step 4 as a checklist to run once Task 5 lands (not blocking Task 5's own review).

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/styles.css public/app.js
git commit -m "Add the dashboard frontend (storyline progress, filterable task list)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Wiring entry point

**Files:**
- Create: `src/app.ts`
- Test: `src/app.test.ts`

**Interfaces:**
- Consumes: `syncTaskGraph`, `runBackfill`, `LogTailer`, `ProgressStore`, `deriveStorylines`, `loadCache` and their types, all from `src/index.js` (Plans 1-2's public surface); `createServer` from `src/server/createServer.js` (Task 1); `createApiRoutes` from `src/server/apiRoutes.js` (Task 3).
- Produces: `AppConfig` interface (all fields optional, with defaults applied inside) and `startApp(config?: AppConfig): Promise<{ server: http.Server; store: ProgressStore; tailer: LogTailer }>` from `src/app.ts`. When this file is run directly (not imported), it calls `startApp()` with no overrides and logs the URL.

**Design note — binding to loopback only:** `server.listen(port, "127.0.0.1", ...)` — not `0.0.0.0`, not omitted (which defaults to all interfaces). This is the one place in the whole project where "local-only" is actually enforced by a network-level decision rather than just "we don't call any cloud API" — get this wrong and the dashboard (and the quest-progress data it serves) would be reachable from other devices on the same network.

**Design note — testability vs. being a real entry point:** `startApp` is exported and does the real work; the bottom of the file only auto-invokes it when this module is the process's actual entry point (checked via comparing `import.meta.url` to `process.argv[1]`), so importing `app.ts` from a test never launches a real server as a side effect of the import.

- [ ] **Step 1: Write the failing test**

Create `src/app.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app.test.ts`
Expected: FAIL — `Cannot find module './app.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/app.ts`:

```ts
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
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app.test.ts`
Expected: PASS — 1 test green.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — everything across the whole project green (Plan 1 + Plan 2's tests plus this plan's new tests: 7 createServer + 12 apiData + 3 apiRoutes + 1 app = 23 new tests — the exact count doesn't matter, zero failures does).

- [ ] **Step 6: Do Task 4's manual verification now**

Go back to Task 4's Step 4 and actually run through it against this real, working server (`npx tsc -p tsconfig.json && node dist/app.js`, or run `src/app.ts` directly with `tsx`/`ts-node` if that's more convenient — either way, the point is confirming the real dashboard renders real data end-to-end).

- [ ] **Step 7: Commit**

```bash
git add src/app.ts src/app.test.ts
git commit -m "Add app entry point wiring sync, backfill, live-tail, and the server together

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## What this plan does not cover (by design)

- **A system tray shell / background-process packaging.** Running `node dist/app.js` (or `npx tsx src/app.ts` during development) in a terminal is the v1 experience. A tray icon that runs this in the background and opens the dashboard in the default browser is a natural follow-up, not built here.
- **Auto-detecting the EFT install path.** Same decision as Plan 2: `logsRootDir` defaults to the standard install location but is overridable via `TARKOV_LOGS_DIR` — no registry/Steam-manifest lookup chain.
- **Squad/shared views, authentication, or any multi-user concept.** Out of scope for the whole project's v1 per the original design spec.
