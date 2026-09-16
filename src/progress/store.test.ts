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
