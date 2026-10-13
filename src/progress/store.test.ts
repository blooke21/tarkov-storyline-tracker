import { describe, it, expect, afterEach } from "vitest";
import { ProgressStore } from "./store.js";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

  it("overwrites the status when a newer event for the same task arrives", () => {
    store = new ProgressStore(":memory:");
    store.recordEvent("task-1", "accepted", new Date("2026-01-01T00:00:00.000Z"));
    store.recordEvent("task-1", "completed", new Date("2026-01-01T01:00:00.000Z"));
    expect(store.getStatus("task-1")).toBe("completed");
  });

  it("ignores an older event arriving after a newer one (e.g. log backfill replaying history)", () => {
    store = new ProgressStore(":memory:");
    store.recordEvent("task-1", "completed", new Date("2026-01-01T01:00:00.000Z"));
    store.recordEvent("task-1", "accepted", new Date("2026-01-01T00:00:00.000Z"));
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

describe("ProgressStore metadata", () => {
  it("returns null for a key that has never been set", () => {
    store = new ProgressStore(":memory:");
    expect(store.getMeta("lastRaidSeenAt")).toBeNull();
  });

  it("sets and retrieves a metadata value", () => {
    store = new ProgressStore(":memory:");
    store.setMeta("lastRaidSeenAt", "2026-09-16T13:20:11.174Z");
    expect(store.getMeta("lastRaidSeenAt")).toBe("2026-09-16T13:20:11.174Z");
  });

  it("overwrites an existing metadata value", () => {
    store = new ProgressStore(":memory:");
    store.setMeta("lastRaidSeenAt", "2026-09-16T13:20:11.174Z");
    store.setMeta("lastRaidSeenAt", "2026-09-17T09:00:00.000Z");
    expect(store.getMeta("lastRaidSeenAt")).toBe("2026-09-17T09:00:00.000Z");
  });
});

describe("ProgressStore wipe boundary", () => {
  it("has no boundary until one is set", () => {
    store = new ProgressStore(":memory:");
    expect(store.getProgressSince()).toBeNull();
  });

  it("resetProgress clears every recorded task and remembers the boundary", () => {
    store = new ProgressStore(":memory:");
    store.recordEvent("task-1", "completed", new Date("2026-10-01T00:00:00.000Z"));
    store.recordEvent("task-2", "accepted", new Date("2026-10-02T00:00:00.000Z"));
    const since = new Date("2026-10-10T15:12:00.000Z");

    store.resetProgress(since);

    expect(store.getAllStatuses().size).toBe(0);
    expect(store.getProgressSince()).toEqual(since);
  });

  it("leaves unrelated metadata alone", () => {
    store = new ProgressStore(":memory:");
    store.setMeta("lastRaidSeenAt", "2026-10-08T03:13:17.034Z");

    store.resetProgress(new Date("2026-10-10T15:12:00.000Z"));

    expect(store.getMeta("lastRaidSeenAt")).toBe("2026-10-08T03:13:17.034Z");
  });

  it("moves the boundary on a second wipe", () => {
    store = new ProgressStore(":memory:");
    store.resetProgress(new Date("2026-10-10T15:12:00.000Z"));

    store.resetProgress(new Date("2027-03-01T00:00:00.000Z"));

    expect(store.getProgressSince()).toEqual(new Date("2027-03-01T00:00:00.000Z"));
  });

  it("leaves everything untouched if a wipe fails partway (all or nothing)", () => {
    store = new ProgressStore(":memory:");
    store.recordEvent("task-1", "completed", new Date("2026-10-01T00:00:00.000Z"));

    // An invalid date makes the wipe fail after it has already started deleting.
    expect(() => store!.resetProgress(new Date("not a date"))).toThrow();

    expect(store.getStatus("task-1")).toBe("completed");
    expect(store.getProgressSince()).toBeNull();
  });

  it("returns null rather than throwing if the stored boundary is corrupt", () => {
    store = new ProgressStore(":memory:");
    store.setMeta("progressSince", "not a date");

    expect(store.getProgressSince()).toBeNull();
  });
});

describe("ProgressStore game modes", () => {
  it("keeps each mode's quest progress separate", () => {
    const store = new ProgressStore(":memory:");
    store.recordEvent("quest-a", "completed");

    const pvp = store.forMode("regular");
    const season = store.forMode("pvp-season");
    pvp.recordEvent("quest-a", "failed");
    season.recordEvent("quest-b", "accepted");

    expect(store.getStatus("quest-a")).toBe("completed");
    expect(pvp.getStatus("quest-a")).toBe("failed");
    expect(season.getStatus("quest-a")).toBeNull();
    expect([...season.getAllStatuses()]).toEqual([["quest-b", "accepted"]]);
    expect(store.getStatus("quest-b")).toBeNull();
    store.close();
  });

  it("switches what a store looks at with setMode, so one shared object can follow the toggle", () => {
    const store = new ProgressStore(":memory:");
    store.forMode("regular").recordEvent("quest-a", "completed");

    expect(store.getStatus("quest-a")).toBeNull();
    store.setMode("regular");
    expect(store.mode).toBe("regular");
    expect(store.getStatus("quest-a")).toBe("completed");
    store.close();
  });

  it("keeps things like the reset boundary, chapters and pins per mode, and shares the watcher's own bookkeeping", () => {
    const store = new ProgressStore(":memory:");
    const pvp = store.forMode("regular");
    store.setMeta("pinnedTasks", '["a"]');
    pvp.setMeta("pinnedTasks", '["b"]');
    pvp.resetProgress(new Date("2026-10-01T00:00:00Z"));
    store.setMeta("lastWatcherPollAt", "2026-10-12T12:00:00.000Z");

    expect(store.getMeta("pinnedTasks")).toBe('["a"]');
    expect(pvp.getMeta("pinnedTasks")).toBeNull(); // PvP's reset cleared PvP's pins only
    expect(store.getProgressSince()).toBeNull();
    expect(pvp.getProgressSince()).toEqual(new Date("2026-10-01T00:00:00Z"));
    expect(pvp.getMeta("lastWatcherPollAt")).toBe("2026-10-12T12:00:00.000Z");
    store.close();
  });

  it("resetting one mode leaves the others' quests alone", () => {
    const store = new ProgressStore(":memory:");
    const season = store.forMode("pvp-season");
    store.recordEvent("quest-a", "completed");
    season.recordEvent("quest-a", "completed");

    season.resetProgress(new Date());

    expect(store.getStatus("quest-a")).toBe("completed");
    expect(season.getStatus("quest-a")).toBeNull();
    store.close();
  });

  it("closing a view leaves the shared database open", () => {
    const store = new ProgressStore(":memory:");
    store.forMode("regular").close();

    expect(() => store.recordEvent("quest-a", "accepted")).not.toThrow();
    store.close();
  });
});

describe("ProgressStore upgrading a database from before game modes", () => {
  it("treats everything already saved as PvE, including its reset boundary", () => {
    const dir = mkdtempSync(join(tmpdir(), "tarkov-migrate-test-"));
    const path = join(dir, "old.sqlite");
    try {
      const old = new Database(path);
      old.exec(`
        CREATE TABLE task_progress (task_id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('accepted', 'completed', 'failed')), updated_at TEXT NOT NULL);
        CREATE TABLE store_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO task_progress VALUES ('quest-a', 'completed', '2026-10-10T15:00:00.000Z'), ('quest-b', 'accepted', '2026-10-10T15:05:00.000Z');
        INSERT INTO store_meta VALUES ('progressSince', '2026-10-10T15:13:23.000Z'), ('prestigeProgress', '{"level":1,"done":[]}');
      `);
      old.close();

      const store = new ProgressStore(path);

      expect(store.getAllStatuses().size).toBe(2);
      expect(store.getStatus("quest-a")).toBe("completed");
      expect(store.getProgressSince()).toEqual(new Date("2026-10-10T15:13:23.000Z"));
      expect(store.getMeta("prestigeProgress")).toBe('{"level":1,"done":[]}');
      expect(store.forMode("regular").getAllStatuses().size).toBe(0);
      expect(store.forMode("regular").getMeta("prestigeProgress")).toBeNull();

      store.recordEvent("quest-c", "failed");
      store.close();
      const reopened = new ProgressStore(path);
      expect(reopened.getAllStatuses().size).toBe(3);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
