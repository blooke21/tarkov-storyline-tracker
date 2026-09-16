import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LogTailer } from "./liveTail.js";
import { ProgressStore } from "../progress/store.js";

let tempDir: string | undefined;
let store: ProgressStore | undefined;
let tailer: LogTailer | undefined;

afterEach(() => {
  tailer?.stop();
  tailer = undefined;
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
  store?.close();
  store = undefined;
  vi.useRealTimers();
});

function writeSessionWithTask(logsRoot: string, folderName: string, taskId: string): string {
  const sessionDir = join(logsRoot, folderName);
  mkdirSync(sessionDir, { recursive: true });
  const notifications = [
    "2026-09-16 13:20:00.000|1.1.5.0.47426|Info|push-notifications|Got notification | ChatMessageReceived",
    "{",
    `  "message": { "type": 10, "dt": 1700000000, "templateId": "${taskId} description" }`,
    "}",
  ].join("\n");
  const notificationsPath = join(sessionDir, "prefix push-notifications_000.log");
  writeFileSync(notificationsPath, notifications);
  return notificationsPath;
}

describe("LogTailer.poll", () => {
  it("applies the latest session's events to the store", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-livetail-test-"));
    writeSessionWithTask(tempDir, "log_2026.09.16_13-19-26_1.1.5.0.47426", "aaaaaaaaaaaaaaaaaaaaaaaa");
    store = new ProgressStore(":memory:");
    tailer = new LogTailer(tempDir, store);

    tailer.poll();

    expect(store.getStatus("aaaaaaaaaaaaaaaaaaaaaaaa")).toBe("accepted");
  });

  it("picks up new content appended to the file between polls", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-livetail-test-"));
    const notificationsPath = writeSessionWithTask(
      tempDir,
      "log_2026.09.16_13-19-26_1.1.5.0.47426",
      "aaaaaaaaaaaaaaaaaaaaaaaa"
    );
    store = new ProgressStore(":memory:");
    tailer = new LogTailer(tempDir, store);
    tailer.poll();
    expect(store.getStatus("bbbbbbbbbbbbbbbbbbbbbbbb")).toBeNull();

    const moreContent = [
      "",
      "2026-09-16 13:21:00.000|1.1.5.0.47426|Info|push-notifications|Got notification | ChatMessageReceived",
      "{",
      '  "message": { "type": 10, "dt": 1700000100, "templateId": "bbbbbbbbbbbbbbbbbbbbbbbb description" }',
      "}",
    ].join("\n");
    writeFileSync(notificationsPath, require("node:fs").readFileSync(notificationsPath, "utf-8") + moreContent);
    tailer.poll();

    expect(store.getStatus("bbbbbbbbbbbbbbbbbbbbbbbb")).toBe("accepted");
  });

  it("does nothing when there is no session yet, without throwing", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-livetail-test-"));
    store = new ProgressStore(":memory:");
    tailer = new LogTailer(tempDir, store);

    expect(() => tailer!.poll()).not.toThrow();
    expect(store.getMeta("lastWatcherPollAt")).toBeNull();
  });

  it("stamps lastWatcherPollAt on every successful poll", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-livetail-test-"));
    writeSessionWithTask(tempDir, "log_2026.09.16_13-19-26_1.1.5.0.47426", "aaaaaaaaaaaaaaaaaaaaaaaa");
    store = new ProgressStore(":memory:");
    tailer = new LogTailer(tempDir, store);

    tailer.poll();

    const stamped = store.getMeta("lastWatcherPollAt");
    expect(stamped).not.toBeNull();
    expect(Number.isNaN(new Date(stamped!).getTime())).toBe(false);
  });

  it("stamps lastWatcherPollAt even when a log file in the session is unreadable (handled gracefully by readSafely)", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-livetail-test-"));
    const sessionDir = join(tempDir, "log_2026.09.16_13-19-26_1.1.5.0.47426");
    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(join(sessionDir, "prefix push-notifications_000.log")); // a directory, not a file
    store = new ProgressStore(":memory:");
    tailer = new LogTailer(tempDir, store);

    expect(() => tailer!.poll()).not.toThrow();
    expect(store.getMeta("lastWatcherPollAt")).not.toBeNull();
  });

  it("does not throw and does not stamp lastWatcherPollAt when the store itself throws (e.g. already closed)", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-livetail-test-"));
    writeSessionWithTask(tempDir, "log_2026.09.16_13-19-26_1.1.5.0.47426", "aaaaaaaaaaaaaaaaaaaaaaaa");
    store = new ProgressStore(":memory:");
    store.close(); // force any subsequent store call to throw
    tailer = new LogTailer(tempDir, store);

    expect(() => tailer!.poll()).not.toThrow();
    expect(() => store!.getMeta("lastWatcherPollAt")).toThrow(); // store is closed, can't even check via getMeta
  });
});

describe("LogTailer.start / stop", () => {
  it("polls repeatedly on the configured interval until stopped", () => {
    vi.useFakeTimers();
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-livetail-test-"));
    writeSessionWithTask(tempDir, "log_2026.09.16_13-19-26_1.1.5.0.47426", "aaaaaaaaaaaaaaaaaaaaaaaa");
    store = new ProgressStore(":memory:");
    tailer = new LogTailer(tempDir, store, { pollIntervalMs: 1000 });
    const pollSpy = vi.spyOn(tailer, "poll");

    tailer.start();
    expect(pollSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3500);
    expect(pollSpy).toHaveBeenCalledTimes(4);

    tailer.stop();
    vi.advanceTimersByTime(5000);
    expect(pollSpy).toHaveBeenCalledTimes(4);
  });
});
