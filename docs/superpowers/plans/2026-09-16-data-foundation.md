# Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the local, game-independent data layer for the Tarkov Storyline Tracker: fetch and cache the task graph from tarkov.dev, derive named storylines from it, and persist quest progress locally.

**Architecture:** Four small TypeScript modules with no dependency on the running game: a tarkov.dev GraphQL client, a JSON disk cache for the fetched task graph, a pure function that groups tasks into storylines, and a SQLite-backed store for recorded quest progress. This is Plan 1 of 3 — Plan 2 will add the log watcher that calls into the progress store built here, and Plan 3 will add the local HTTP server and dashboard that read from all of it.

**Tech Stack:** Node.js >= 20, TypeScript (strict mode, ESM/NodeNext), Vitest for tests, `better-sqlite3` for local storage. No bundler needed yet — this plan produces a library consumed by later plans, not a shippable executable.

**Spec:** `docs/superpowers/specs/2026-09-16-tarkov-storyline-tracker-design.md`

## Global Constraints

- No cloud backend, no accounts, no data leaving the machine (spec: local-only architecture).
- Windows is the only supported target platform (spec: matches the game's platform) — nothing in this plan is Windows-specific, but avoid POSIX-only assumptions (e.g. path separators) since later plans run on Windows exclusively.
- TypeScript strict mode throughout.
- Every module in this plan must be usable and testable without a running EFT install or network access at test time (tests mock the network; only a real invocation of `fetchTasks` touches the network).
- Storyline grouping must be derived from tarkov.dev's own data fields (`kappaRequired`, `lightkeeperRequired`, `factionName`), not a hand-maintained list of quest names (spec: storylines must survive wipes/patches without manual upkeep).

---

### Task 1: Project scaffold + tarkov.dev GraphQL client

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/tarkovData/types.ts`
- Create: `src/tarkovData/client.ts`
- Test: `src/tarkovData/client.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `TarkovTrader`, `TaskObjective`, `TaskStatusRequirement`, `TarkovTask` interfaces from `src/tarkovData/types.ts`.
  - `TARKOV_DEV_GRAPHQL_URL: string` and `fetchTasks(fetchImpl?: typeof fetch): Promise<TarkovTask[]>` from `src/tarkovData/client.ts`. `fetchTasks` throws an `Error` on a non-OK HTTP response, on a GraphQL `errors` array, or on a missing `data` field.

- [ ] **Step 1: Create the project scaffold**

Create `package.json`:

```json
{
  "name": "tarkov-storyline-tracker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "better-sqlite3": "^11.3.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^20.14.0",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

Create `.gitignore`:

```
node_modules/
dist/
*.tsbuildinfo
.tarkov-cache.json
*.sqlite
```

Run: `npm install`
Expected: installs `better-sqlite3`, `typescript`, `vitest`, and the `@types` packages with no errors.

- [ ] **Step 2: Write the failing test**

Create `src/tarkovData/client.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { fetchTasks, TARKOV_DEV_GRAPHQL_URL } from "./client.js";
import type { TarkovTask } from "./types.js";

const sampleTask: TarkovTask = {
  id: "1",
  name: "Debut",
  trader: { id: "t1", name: "Prapor" },
  wikiLink: "https://escapefromtarkov.fandom.com/wiki/Debut",
  kappaRequired: false,
  lightkeeperRequired: false,
  factionName: null,
  minPlayerLevel: 1,
  objectives: [],
  taskRequirements: [],
};

describe("fetchTasks", () => {
  it("returns the tasks array from a successful response", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { tasks: [sampleTask] } }),
    });

    const tasks = await fetchTasks(fakeFetch as unknown as typeof fetch);

    expect(tasks).toEqual([sampleTask]);
    expect(fakeFetch).toHaveBeenCalledWith(
      TARKOV_DEV_GRAPHQL_URL,
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws when the HTTP response is not ok", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    await expect(fetchTasks(fakeFetch as unknown as typeof fetch)).rejects.toThrow(
      "tarkov.dev API request failed: 500 Internal Server Error"
    );
  });

  it("throws when the response contains GraphQL errors", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ errors: [{ message: "Field not found" }] }),
    });

    await expect(fetchTasks(fakeFetch as unknown as typeof fetch)).rejects.toThrow(
      "tarkov.dev API returned errors: Field not found"
    );
  });

  it("throws when the response has no data field", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await expect(fetchTasks(fakeFetch as unknown as typeof fetch)).rejects.toThrow(
      "tarkov.dev API returned no data"
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/tarkovData/client.test.ts`
Expected: FAIL — `Cannot find module './client.js'` (or `./types.js`), since neither file exists yet.

- [ ] **Step 4: Write the minimal implementation**

Create `src/tarkovData/types.ts`:

```ts
export interface TarkovTrader {
  id: string;
  name: string;
}

export interface TaskObjective {
  id: string | null;
  type: string;
  description: string;
  optional: boolean;
}

export interface TaskStatusRequirement {
  status: string[];
  task: { id: string };
}

export interface TarkovTask {
  id: string;
  name: string;
  trader: TarkovTrader;
  wikiLink: string | null;
  kappaRequired: boolean;
  lightkeeperRequired: boolean;
  factionName: string | null;
  minPlayerLevel: number | null;
  objectives: TaskObjective[];
  taskRequirements: TaskStatusRequirement[];
}
```

Create `src/tarkovData/client.ts`:

```ts
import type { TarkovTask } from "./types.js";

export const TARKOV_DEV_GRAPHQL_URL = "https://api.tarkov.dev/graphql";

const TASKS_QUERY = `
  query GetTasks {
    tasks(lang: en) {
      id
      name
      wikiLink
      kappaRequired
      lightkeeperRequired
      factionName
      minPlayerLevel
      trader { id name }
      objectives { id type description optional }
      taskRequirements { status task { id } }
    }
  }
`;

interface GraphQLResponse {
  data?: { tasks: TarkovTask[] };
  errors?: Array<{ message: string }>;
}

export async function fetchTasks(fetchImpl: typeof fetch = fetch): Promise<TarkovTask[]> {
  const response = await fetchImpl(TARKOV_DEV_GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: TASKS_QUERY }),
  });

  if (!response.ok) {
    throw new Error(`tarkov.dev API request failed: ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as GraphQLResponse;

  if (body.errors && body.errors.length > 0) {
    throw new Error(`tarkov.dev API returned errors: ${body.errors.map((e) => e.message).join("; ")}`);
  }

  if (!body.data) {
    throw new Error("tarkov.dev API returned no data");
  }

  return body.data.tasks;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/tarkovData/client.test.ts`
Expected: PASS — all 4 tests green.

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore src/tarkovData/types.ts src/tarkovData/client.ts src/tarkovData/client.test.ts package-lock.json
git commit -m "Add project scaffold and tarkov.dev GraphQL client

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Local task-graph disk cache

**Files:**
- Create: `src/tarkovData/cache.ts`
- Test: `src/tarkovData/cache.test.ts`

**Interfaces:**
- Consumes: `TarkovTask` from `src/tarkovData/types.ts` (Task 1).
- Produces:
  - `TaskCache` interface `{ fetchedAt: string; tasks: TarkovTask[] }`.
  - `saveCache(cachePath: string, tasks: TarkovTask[], now?: Date): void`.
  - `loadCache(cachePath: string): TaskCache | null` (returns `null` if the file doesn't exist).
  - `isStale(fetchedAt: string, maxAgeMs: number, now?: Date): boolean`.
  All from `src/tarkovData/cache.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/tarkovData/cache.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveCache, loadCache, isStale } from "./cache.js";
import type { TarkovTask } from "./types.js";

const sampleTasks: TarkovTask[] = [
  {
    id: "1",
    name: "Debut",
    trader: { id: "t1", name: "Prapor" },
    wikiLink: "https://escapefromtarkov.fandom.com/wiki/Debut",
    kappaRequired: false,
    lightkeeperRequired: false,
    factionName: null,
    minPlayerLevel: 1,
    objectives: [],
    taskRequirements: [],
  },
];

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("saveCache / loadCache", () => {
  it("round-trips tasks and a fetchedAt timestamp", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-cache-test-"));
    const cachePath = join(tempDir, "cache.json");
    const now = new Date("2026-01-01T00:00:00.000Z");

    saveCache(cachePath, sampleTasks, now);
    const loaded = loadCache(cachePath);

    expect(loaded).not.toBeNull();
    expect(loaded?.tasks).toEqual(sampleTasks);
    expect(loaded?.fetchedAt).toBe(now.toISOString());
  });

  it("returns null when the cache file does not exist", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-cache-test-"));
    const cachePath = join(tempDir, "missing.json");

    expect(loadCache(cachePath)).toBeNull();
  });
});

describe("isStale", () => {
  it("returns false when the cache is younger than maxAgeMs", () => {
    const fetchedAt = new Date("2026-01-01T00:00:00.000Z").toISOString();
    const now = new Date("2026-01-01T01:00:00.000Z");
    expect(isStale(fetchedAt, 2 * 60 * 60 * 1000, now)).toBe(false);
  });

  it("returns true when the cache is older than maxAgeMs", () => {
    const fetchedAt = new Date("2026-01-01T00:00:00.000Z").toISOString();
    const now = new Date("2026-01-02T00:00:00.000Z");
    expect(isStale(fetchedAt, 60 * 60 * 1000, now)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tarkovData/cache.test.ts`
Expected: FAIL — `Cannot find module './cache.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/tarkovData/cache.ts`:

```ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { TarkovTask } from "./types.js";

export interface TaskCache {
  fetchedAt: string;
  tasks: TarkovTask[];
}

export function saveCache(cachePath: string, tasks: TarkovTask[], now: Date = new Date()): void {
  const cache: TaskCache = { fetchedAt: now.toISOString(), tasks };
  writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf-8");
}

export function loadCache(cachePath: string): TaskCache | null {
  if (!existsSync(cachePath)) {
    return null;
  }
  const raw = readFileSync(cachePath, "utf-8");
  return JSON.parse(raw) as TaskCache;
}

export function isStale(fetchedAt: string, maxAgeMs: number, now: Date = new Date()): boolean {
  const fetchedTime = new Date(fetchedAt).getTime();
  return now.getTime() - fetchedTime > maxAgeMs;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/tarkovData/cache.test.ts`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/tarkovData/cache.ts src/tarkovData/cache.test.ts
git commit -m "Add local disk cache for the tarkov.dev task graph

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Storyline deriver

**Files:**
- Create: `src/storylines/deriveStorylines.ts`
- Test: `src/storylines/deriveStorylines.test.ts`

**Interfaces:**
- Consumes: `TarkovTask` from `src/tarkovData/types.ts` (Task 1).
- Produces: `Storyline` interface `{ id: string; name: string; taskIds: string[] }` and `deriveStorylines(tasks: TarkovTask[]): Storyline[]` from `src/storylines/deriveStorylines.ts`.

**Design note (refines the spec's "trace connected prerequisite chains" language now that the real schema is known):** tarkov.dev already curates `kappaRequired`, `lightkeeperRequired`, and `factionName` directly on each task. Deriving storylines from these fields is more reliable than inferring graph clusters from `taskRequirements`, and is still fully data-driven rather than a hand-maintained quest list. A task can belong to more than one storyline (e.g. a USEC-only task that's also Kappa-required) — storylines are overlapping views, not a strict partition. Empty storylines (no tasks currently match, e.g. no `lightkeeperRequired` tasks in some future data shape) are omitted from the result rather than shown as a mysterious 0/0.

- [ ] **Step 1: Write the failing test**

Create `src/storylines/deriveStorylines.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deriveStorylines } from "./deriveStorylines.js";
import type { TarkovTask } from "../tarkovData/types.js";

function makeTask(overrides: Partial<TarkovTask> & { id: string }): TarkovTask {
  return {
    name: `Task ${overrides.id}`,
    trader: { id: "t1", name: "Prapor" },
    wikiLink: null,
    kappaRequired: false,
    lightkeeperRequired: false,
    factionName: null,
    minPlayerLevel: null,
    objectives: [],
    taskRequirements: [],
    ...overrides,
  };
}

describe("deriveStorylines", () => {
  it("groups kappa-required tasks into a Path to Kappa storyline", () => {
    const tasks = [makeTask({ id: "1", kappaRequired: true }), makeTask({ id: "2", kappaRequired: false })];
    const storylines = deriveStorylines(tasks);
    const kappa = storylines.find((s) => s.id === "kappa");
    expect(kappa?.taskIds).toEqual(["1"]);
  });

  it("groups lightkeeper-required tasks into a Lightkeeper storyline", () => {
    const tasks = [makeTask({ id: "1", lightkeeperRequired: true })];
    const storylines = deriveStorylines(tasks);
    const lightkeeper = storylines.find((s) => s.id === "lightkeeper");
    expect(lightkeeper?.taskIds).toEqual(["1"]);
  });

  it("groups tasks with a factionName into their faction's storyline", () => {
    const tasks = [
      makeTask({ id: "1", factionName: "USEC" }),
      makeTask({ id: "2", factionName: "BEAR" }),
      makeTask({ id: "3", factionName: null }),
    ];
    const storylines = deriveStorylines(tasks);
    expect(storylines.find((s) => s.id === "usec")?.taskIds).toEqual(["1"]);
    expect(storylines.find((s) => s.id === "bear")?.taskIds).toEqual(["2"]);
    expect(storylines.find((s) => s.id === "main-story")?.taskIds).toEqual(["3"]);
  });

  it("allows a task to appear in more than one storyline", () => {
    const tasks = [makeTask({ id: "1", kappaRequired: true, factionName: "USEC" })];
    const storylines = deriveStorylines(tasks);
    expect(storylines.find((s) => s.id === "kappa")?.taskIds).toContain("1");
    expect(storylines.find((s) => s.id === "usec")?.taskIds).toContain("1");
  });

  it("omits storylines with no matching tasks", () => {
    const tasks = [makeTask({ id: "1" })];
    const storylines = deriveStorylines(tasks);
    expect(storylines.find((s) => s.id === "lightkeeper")).toBeUndefined();
    expect(storylines.find((s) => s.id === "usec")).toBeUndefined();
    expect(storylines.find((s) => s.id === "bear")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/storylines/deriveStorylines.test.ts`
Expected: FAIL — `Cannot find module './deriveStorylines.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/storylines/deriveStorylines.ts`:

```ts
import type { TarkovTask } from "../tarkovData/types.js";

export interface Storyline {
  id: string;
  name: string;
  taskIds: string[];
}

export function deriveStorylines(tasks: TarkovTask[]): Storyline[] {
  const storylines: Storyline[] = [
    { id: "kappa", name: "Path to Kappa", taskIds: tasks.filter((t) => t.kappaRequired).map((t) => t.id) },
    {
      id: "lightkeeper",
      name: "Lightkeeper",
      taskIds: tasks.filter((t) => t.lightkeeperRequired).map((t) => t.id),
    },
    {
      id: "main-story",
      name: "Main Story",
      taskIds: tasks.filter((t) => !t.factionName).map((t) => t.id),
    },
    { id: "usec", name: "USEC", taskIds: tasks.filter((t) => t.factionName === "USEC").map((t) => t.id) },
    { id: "bear", name: "BEAR", taskIds: tasks.filter((t) => t.factionName === "BEAR").map((t) => t.id) },
  ];

  return storylines.filter((storyline) => storyline.taskIds.length > 0);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/storylines/deriveStorylines.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/storylines/deriveStorylines.ts src/storylines/deriveStorylines.test.ts
git commit -m "Add storyline deriver grouping tasks by kappa/lightkeeper/faction

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Local progress store

**Files:**
- Create: `src/progress/store.ts`
- Test: `src/progress/store.test.ts`

**Interfaces:**
- Consumes: nothing (task IDs are opaque strings here; Plan 2's log watcher and Plan 3's dashboard will pass in `TarkovTask.id` values from Task 1).
- Produces:
  - `TaskStatus` type: `"accepted" | "completed" | "failed"`.
  - `ProgressStore` class from `src/progress/store.ts` with:
    - `constructor(dbPath: string)` — pass `":memory:"` for an in-memory store.
    - `recordEvent(taskId: string, status: TaskStatus, occurredAt?: Date): void`
    - `getStatus(taskId: string): TaskStatus | null`
    - `getAllStatuses(): Map<string, TaskStatus>`
    - `close(): void`

- [ ] **Step 1: Write the failing test**

Create `src/progress/store.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { ProgressStore } from "./store.js";

let store: ProgressStore | undefined;

afterEach(() => {
  store?.close();
  store = undefined;
});

describe("ProgressStore", () => {
  it("returns null for a task with no recorded status", () => {
    store = new ProgressStore(":memory:");
    expect(store.getStatus("task-1")).toBeNull();
  });

  it("records and retrieves a task's status", () => {
    store = new ProgressStore(":memory:");
    store.recordEvent("task-1", "accepted");
    expect(store.getStatus("task-1")).toBe("accepted");
  });

  it("overwrites the status when the same task is recorded again", () => {
    store = new ProgressStore(":memory:");
    store.recordEvent("task-1", "accepted");
    store.recordEvent("task-1", "completed");
    expect(store.getStatus("task-1")).toBe("completed");
  });

  it("returns all recorded statuses as a map", () => {
    store = new ProgressStore(":memory:");
    store.recordEvent("task-1", "accepted");
    store.recordEvent("task-2", "completed");
    const all = store.getAllStatuses();
    expect(all.get("task-1")).toBe("accepted");
    expect(all.get("task-2")).toBe("completed");
    expect(all.size).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/progress/store.test.ts`
Expected: FAIL — `Cannot find module './store.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/progress/store.ts`:

```ts
import Database from "better-sqlite3";

export type TaskStatus = "accepted" | "completed" | "failed";

interface ProgressRow {
  task_id: string;
  status: TaskStatus;
}

export class ProgressStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_progress (
        task_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  }

  recordEvent(taskId: string, status: TaskStatus, occurredAt: Date = new Date()): void {
    this.db
      .prepare(
        `INSERT INTO task_progress (task_id, status, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(task_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`
      )
      .run(taskId, status, occurredAt.toISOString());
  }

  getStatus(taskId: string): TaskStatus | null {
    const row = this.db.prepare(`SELECT status FROM task_progress WHERE task_id = ?`).get(taskId) as
      | ProgressRow
      | undefined;
    return row ? row.status : null;
  }

  getAllStatuses(): Map<string, TaskStatus> {
    const rows = this.db.prepare(`SELECT task_id, status FROM task_progress`).all() as ProgressRow[];
    return new Map(rows.map((row) => [row.task_id, row.status]));
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/progress/store.test.ts`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — all tests across all four modules green (17 tests total).

- [ ] **Step 6: Commit**

```bash
git add src/progress/store.ts src/progress/store.test.ts
git commit -m "Add SQLite-backed local progress store

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## What this plan does not cover (by design — see Plans 2 and 3)

- Reading the game's actual log files (Plan 2).
- The local HTTP server and browser dashboard (Plan 3).
- System tray packaging (Plan 3 or later polish).

Everything in this plan is verifiable today, without an EFT install: `npm test` after Task 4 exercises the full data layer end-to-end (network-mocked fetch → cache round-trip → storyline grouping → progress persistence).
