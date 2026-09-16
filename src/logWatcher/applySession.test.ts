import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySessionToStore } from "./applySession.js";
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

function writeSession(sessionDir: string, notificationsText: string, applicationText: string): void {
  mkdirSync(sessionDir, { recursive: true });
  const prefix = "2026.09.16_13-19-26_1.1.5.0.47426";
  writeFileSync(join(sessionDir, `${prefix} push-notifications_000.log`), notificationsText);
  writeFileSync(join(sessionDir, `${prefix} application_000.log`), applicationText);
}

describe("applySessionToStore", () => {
  it("applies a task event from the notifications log to the progress store", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-apply-session-test-"));
    const sessionDir = join(tempDir, "log_2026.09.16_13-19-26_1.1.5.0.47426");
    const notifications = [
      "2026-09-16 13:20:00.000|1.1.5.0.47426|Info|push-notifications|Got notification | ChatMessageReceived",
      "{",
      '  "message": { "type": 10, "dt": 1700000000, "templateId": "aaaaaaaaaaaaaaaaaaaaaaaa description" }',
      "}",
    ].join("\n");
    writeSession(sessionDir, notifications, "");
    store = new ProgressStore(":memory:");

    const result = applySessionToStore(sessionDir, store);

    expect(result.taskEventsApplied).toBe(1);
    expect(store.getStatus("aaaaaaaaaaaaaaaaaaaaaaaa")).toBe("accepted");
  });

  it("records lastRaidSeenAt from a raid-start event in the application log", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-apply-session-test-"));
    const sessionDir = join(tempDir, "log_2026.09.16_13-19-26_1.1.5.0.47426");
    const application = [
      "2026-05-31 19:14:50.104|1.0.5.0.45272|Debug|application|TRACE-NetworkGameCreate profileStatus: 'Location: TarkovStreets, RaidMode: Online, shortId: FW3C55'",
      "2026-05-31 19:15:31.816|1.0.5.0.45272|Info|application|GameStarted:1(0) real:1(0) diff:0",
    ].join("\n");
    writeSession(sessionDir, "", application);
    store = new ProgressStore(":memory:");

    const result = applySessionToStore(sessionDir, store);

    expect(result.raidEventsSeen).toBe(1);
    expect(store.getMeta("lastRaidSeenAt")).toBe(new Date(2026, 4, 31, 19, 15, 31, 816).toISOString());
  });

  it("does not overwrite lastRaidSeenAt with an older timestamp", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-apply-session-test-"));
    const sessionDir = join(tempDir, "log_2026.09.16_13-19-26_1.1.5.0.47426");
    writeSession(sessionDir, "", "");
    store = new ProgressStore(":memory:");
    store.setMeta("lastRaidSeenAt", new Date(2027, 0, 1).toISOString());

    applySessionToStore(sessionDir, store);

    expect(store.getMeta("lastRaidSeenAt")).toBe(new Date(2027, 0, 1).toISOString());
  });

  it("rejects an older raid event when a newer lastRaidSeenAt is already stored", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-apply-session-test-"));
    const sessionDir = join(tempDir, "log_2026.09.16_13-19-26_1.1.5.0.47426");
    // A real raid-ended (UserMatchOver) notification dated 2025-11-22 — well
    // before the newer lastRaidSeenAt seeded below.
    const notifications = [
      "2025-11-22 15:44:56.154|1.0.0.1.41923|Info|push-notifications|Got notification | UserMatchOver",
      "{",
      '  "type": "userMatchOver",',
      '  "eventId": "69222ed80324ce18df0f0131",',
      '  "profileid": "profile-placeholder",',
      '  "status": "Free",',
      '  "location": "TarkovStreets",',
      '  "raidMode": "Online",',
      '  "mode": "deathmatch",',
      '  "shortId": null',
      "}",
    ].join("\n");
    writeSession(sessionDir, notifications, "");
    store = new ProgressStore(":memory:");
    const newerTimestamp = new Date(2027, 0, 1).toISOString();
    store.setMeta("lastRaidSeenAt", newerTimestamp);

    const result = applySessionToStore(sessionDir, store);

    expect(result.raidEventsSeen).toBe(1);
    expect(store.getMeta("lastRaidSeenAt")).toBe(newerTimestamp);
  });

  it("takes the max timestamp across both log files when both contain raid events", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-apply-session-test-"));
    const sessionDir = join(tempDir, "log_2026.09.16_13-19-26_1.1.5.0.47426");
    // Older raid-ended notification (2025-11-22) alongside a newer raid-start
    // sequence in the application log (2026-05-31) in the same session.
    const notifications = [
      "2025-11-22 15:44:56.154|1.0.0.1.41923|Info|push-notifications|Got notification | UserMatchOver",
      "{",
      '  "type": "userMatchOver",',
      '  "eventId": "69222ed80324ce18df0f0131",',
      '  "profileid": "profile-placeholder",',
      '  "status": "Free",',
      '  "location": "TarkovStreets",',
      '  "raidMode": "Online",',
      '  "mode": "deathmatch",',
      '  "shortId": null',
      "}",
    ].join("\n");
    const application = [
      "2026-05-31 19:14:50.104|1.0.5.0.45272|Debug|application|TRACE-NetworkGameCreate profileStatus: 'Location: TarkovStreets, RaidMode: Online, shortId: FW3C55'",
      "2026-05-31 19:15:31.816|1.0.5.0.45272|Info|application|GameStarted:1(0) real:1(0) diff:0",
    ].join("\n");
    writeSession(sessionDir, notifications, application);
    store = new ProgressStore(":memory:");

    const result = applySessionToStore(sessionDir, store);

    expect(result.raidEventsSeen).toBe(2);
    expect(store.getMeta("lastRaidSeenAt")).toBe(new Date(2026, 4, 31, 19, 15, 31, 816).toISOString());
  });

  it("handles a session directory with no matching log files without throwing", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-apply-session-test-"));
    const sessionDir = join(tempDir, "empty-session");
    mkdirSync(sessionDir);
    store = new ProgressStore(":memory:");

    const result = applySessionToStore(sessionDir, store);

    expect(result).toEqual({ taskEventsApplied: 0, raidEventsSeen: 0 });
  });

  it("does not throw when a log file path turns out to be unreadable (e.g. a directory)", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-apply-session-test-"));
    const sessionDir = join(tempDir, "log_2026.09.16_13-19-26_1.1.5.0.47426");
    mkdirSync(sessionDir, { recursive: true });
    const prefix = "2026.09.16_13-19-26_1.1.5.0.47426";
    // Create the expected filename AS A DIRECTORY, not a file, so
    // readFileSync fails with EISDIR when applySessionToStore tries to
    // read it.
    mkdirSync(join(sessionDir, `${prefix} push-notifications_000.log`));
    store = new ProgressStore(":memory:");

    expect(() => applySessionToStore(sessionDir, store!)).not.toThrow();
  });
});
