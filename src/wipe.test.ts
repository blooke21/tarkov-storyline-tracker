import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wipeProgress, parseSinceArg } from "./wipe.js";
import { ProgressStore } from "./progress/store.js";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

const OLD_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const NEW_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";

function setUp(): { dbPath: string; logsRootDir: string } {
  tempDir = mkdtempSync(join(tmpdir(), "tarkov-wipe-test-"));
  const logsRootDir = join(tempDir, "logs");
  const sessionDir = join(logsRootDir, "log_2026.09.16_13-19-26_1.1.5.0.47426");
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    join(sessionDir, "2026.09.16_13-19-26_1.1.5.0.47426 push-notifications_000.log"),
    [
      "2026-09-16 13:20:00.000|1.1.5.0.47426|Info|push-notifications|Got notification | ChatMessageReceived",
      "{",
      `  "message": { "type": 12, "dt": 1700000000, "templateId": "${OLD_ID} successMessageText" }`,
      "}",
      "2026-09-16 13:21:00.000|1.1.5.0.47426|Info|push-notifications|Got notification | ChatMessageReceived",
      "{",
      `  "message": { "type": 10, "dt": 1800000000, "templateId": "${NEW_ID} description" }`,
      "}",
    ].join("\n")
  );
  return { dbPath: join(tempDir, "progress.sqlite"), logsRootDir };
}

describe("wipeProgress", () => {
  it("drops the previous character's progress, keeps only what happened since the boundary, and remembers it", () => {
    const { dbPath, logsRootDir } = setUp();
    const before = new ProgressStore(dbPath);
    before.recordEvent(OLD_ID, "completed", new Date(1700000000 * 1000));
    before.close();

    const result = wipeProgress({ dbPath, logsRootDir, since: new Date(1750000000 * 1000) });

    expect(result.tasksPickedUp).toBe(1);
    const after = new ProgressStore(dbPath);
    expect(after.getStatus(OLD_ID)).toBeNull();
    expect(after.getStatus(NEW_ID)).toBe("accepted");
    expect(after.getProgressSince()).toEqual(new Date(1750000000 * 1000));
    after.close();
  });

  it("stays wiped when the app later re-reads the same old logs (the point of remembering the boundary)", () => {
    const { dbPath, logsRootDir } = setUp();
    wipeProgress({ dbPath, logsRootDir, since: new Date(1750000000 * 1000) });

    // What the app does on its next start: backfill over all the logs again.
    const second = wipeProgress({ dbPath, logsRootDir, since: new Date(1750000000 * 1000) });

    expect(second.tasksPickedUp).toBe(1);
    const store = new ProgressStore(dbPath);
    expect(store.getStatus(OLD_ID)).toBeNull();
    store.close();
  });

  it("works when there are no logs at all", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-wipe-test-"));

    const result = wipeProgress({
      dbPath: join(tempDir, "progress.sqlite"),
      logsRootDir: join(tempDir, "no-such-logs"),
      since: new Date(),
    });

    expect(result.tasksPickedUp).toBe(0);
  });
});

describe("parseSinceArg", () => {
  const now = new Date("2026-10-10T15:20:00.000Z");

  it("defaults to now when --since isn't given", () => {
    expect(parseSinceArg([], now)).toEqual(now);
  });

  it("accepts an ISO timestamp", () => {
    expect(parseSinceArg(["--since", "2026-10-10T15:12:00Z"], now)).toEqual(new Date("2026-10-10T15:12:00Z"));
  });

  it("accepts a local date and time", () => {
    expect(parseSinceArg(["--since", "2026-10-10 10:12"], now)).toEqual(new Date(2026, 9, 10, 10, 12));
  });

  it("rejects something that isn't a date, rather than silently wiping from the wrong moment", () => {
    expect(() => parseSinceArg(["--since", "yesterday-ish"], now)).toThrow(/--since/);
  });

  it("rejects --since with no value", () => {
    expect(() => parseSinceArg(["--since"], now)).toThrow(/--since/);
  });
});
