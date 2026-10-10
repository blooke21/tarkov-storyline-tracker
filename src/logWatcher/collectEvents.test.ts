import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectTaskEvents } from "./collectEvents.js";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

function notification(taskId: string, type: number, dt: number): string[] {
  return [
    "2026-09-16 13:20:00.000|1.1.5.0.47426|Info|push-notifications|Got notification | ChatMessageReceived",
    "{",
    `  "message": { "type": ${type}, "dt": ${dt}, "templateId": "${taskId} description" }`,
    "}",
  ];
}

function writeSession(root: string, folder: string, lines: string[]): void {
  const dir = join(root, folder);
  mkdirSync(dir, { recursive: true });
  const prefix = folder.replace(/^log_/, "");
  writeFileSync(join(dir, `${prefix} push-notifications_000.log`), lines.join("\n"));
}

describe("collectTaskEvents", () => {
  it("returns quest events from every session, oldest first, regardless of session order", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-collect-test-"));
    writeSession(tempDir, "log_2026.01.01_10-00-00_1.0.0.0.1", notification("bbbbbbbbbbbbbbbbbbbbbbbb", 12, 1800000000));
    writeSession(tempDir, "log_2025.01.01_10-00-00_1.0.0.0.1", notification("aaaaaaaaaaaaaaaaaaaaaaaa", 10, 1700000000));

    const events = collectTaskEvents(tempDir);

    expect(events.map((e) => [e.taskId, e.status])).toEqual([
      ["aaaaaaaaaaaaaaaaaaaaaaaa", "accepted"],
      ["bbbbbbbbbbbbbbbbbbbbbbbb", "completed"],
    ]);
    expect(events[0].occurredAt).toEqual(new Date(1700000000 * 1000));
  });

  it("leaves out raid-end notifications, which aren't quest events", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-collect-test-"));
    writeSession(tempDir, "log_2026.01.01_10-00-00_1.0.0.0.1", [
      "2026-01-01 10:00:00.000|1.0.0.0.1|Info|push-notifications|Got notification | UserMatchOver",
      "{",
      '  "location": "TarkovStreets"',
      "}",
    ]);

    expect(collectTaskEvents(tempDir)).toEqual([]);
  });

  it("returns an empty list for a missing logs folder instead of throwing", () => {
    expect(collectTaskEvents(join(tmpdir(), "no-such-logs-folder-" + Date.now()))).toEqual([]);
  });

  it("skips a session whose log can't be read and carries on with the rest", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-collect-test-"));
    // A directory where the log file should be: reading it fails.
    mkdirSync(join(tempDir, "log_2025.01.01_10-00-00_1.0.0.0.1", "2025.01.01_10-00-00_1.0.0.0.1 push-notifications_000.log"), {
      recursive: true,
    });
    writeSession(tempDir, "log_2026.01.01_10-00-00_1.0.0.0.1", notification("bbbbbbbbbbbbbbbbbbbbbbbb", 12, 1800000000));

    expect(collectTaskEvents(tempDir)).toHaveLength(1);
  });
});
