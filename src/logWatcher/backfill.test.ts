import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBackfill } from "./backfill.js";
import { ProgressStore } from "../progress/store.js";

let tempDir: string | undefined;
let store: ProgressStore | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
  store?.close();
  store = undefined;
});

function writeSession(logsRoot: string, folderName: string, taskId: string, dt: number): void {
  const sessionDir = join(logsRoot, folderName);
  mkdirSync(sessionDir, { recursive: true });
  const notifications = [
    "2026-09-16 13:20:00.000|1.1.5.0.47426|Info|push-notifications|Got notification | ChatMessageReceived",
    "{",
    `  "message": { "type": 10, "dt": ${dt}, "templateId": "${taskId} description" }`,
    "}",
  ].join("\n");
  writeFileSync(join(sessionDir, "prefix push-notifications_000.log"), notifications);
}

describe("runBackfill", () => {
  it("processes every session folder and applies their task events", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-backfill-test-"));
    writeSession(tempDir, "log_2025.01.01_10-00-00_1.0.0.0.1", "aaaaaaaaaaaaaaaaaaaaaaaa", 1700000000);
    writeSession(tempDir, "log_2026.01.01_10-00-00_1.0.0.0.2", "bbbbbbbbbbbbbbbbbbbbbbbb", 1750000000);
    store = new ProgressStore(":memory:");

    const result = runBackfill(tempDir, store);

    expect(result.sessionsProcessed).toBe(2);
    expect(result.taskEventsApplied).toBe(2);
    expect(store.getStatus("aaaaaaaaaaaaaaaaaaaaaaaa")).toBe("accepted");
    expect(store.getStatus("bbbbbbbbbbbbbbbbbbbbbbbb")).toBe("accepted");
  });

  it("returns zero counts for a logs directory with no sessions", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-backfill-test-"));
    store = new ProgressStore(":memory:");

    const result = runBackfill(tempDir, store);

    expect(result).toEqual({ sessionsProcessed: 0, taskEventsApplied: 0, raidEventsSeen: 0 });
  });

  it("does not throw when the logs directory does not exist", () => {
    store = new ProgressStore(":memory:");
    expect(() => runBackfill(join(tmpdir(), "does-not-exist-" + Date.now()), store!)).not.toThrow();
  });
});
