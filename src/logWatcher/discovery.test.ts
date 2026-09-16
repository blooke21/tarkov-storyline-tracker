import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSessionFolderName, listSessionFolders, findLatestSession, findLogFile } from "./discovery.js";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("parseSessionFolderName", () => {
  it("parses a real session folder name into its timestamp", () => {
    const result = parseSessionFolderName("log_2026.09.16_13-19-26_1.1.5.0.47426");
    expect(result).toEqual(new Date(2026, 8, 16, 13, 19, 26));
  });

  it("parses a single-digit hour correctly", () => {
    const result = parseSessionFolderName("log_2025.11.16_0-28-27_1.0.0.0.41760");
    expect(result).toEqual(new Date(2025, 10, 16, 0, 28, 27));
  });

  it("returns null for a folder name that isn't a session folder", () => {
    expect(parseSessionFolderName("crash_reports")).toBeNull();
  });
});

describe("listSessionFolders", () => {
  it("returns matching session folders sorted oldest to newest, ignoring non-session entries", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-logs-test-"));
    mkdirSync(join(tempDir, "log_2026.09.16_13-19-26_1.1.5.0.47426"));
    mkdirSync(join(tempDir, "log_2025.11.16_0-28-27_1.0.0.0.41760"));
    mkdirSync(join(tempDir, "not_a_session_folder"));
    writeFileSync(join(tempDir, "log_2026.01.01_9-00-00_1.0.0.0.1.txt"), "not a directory");

    const sessions = listSessionFolders(tempDir);

    expect(sessions.map((s) => s.folderName)).toEqual([
      "log_2025.11.16_0-28-27_1.0.0.0.41760",
      "log_2026.09.16_13-19-26_1.1.5.0.47426",
    ]);
  });

  it("returns an empty array when the directory does not exist", () => {
    expect(listSessionFolders(join(tmpdir(), "does-not-exist-" + Date.now()))).toEqual([]);
  });
});

describe("findLatestSession", () => {
  it("returns the most recent session", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-logs-test-"));
    mkdirSync(join(tempDir, "log_2025.11.16_0-28-27_1.0.0.0.41760"));
    mkdirSync(join(tempDir, "log_2026.09.16_13-19-26_1.1.5.0.47426"));

    const latest = findLatestSession(tempDir);

    expect(latest?.folderName).toBe("log_2026.09.16_13-19-26_1.1.5.0.47426");
  });

  it("returns null when there are no sessions", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-logs-test-"));
    expect(findLatestSession(tempDir)).toBeNull();
  });
});

describe("findLogFile", () => {
  it("finds the application and push-notifications logs among real-shaped sibling files, ignoring the rest", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-logs-test-"));
    const sessionDir = join(tempDir, "log_2026.09.16_13-19-26_1.1.5.0.47426");
    mkdirSync(sessionDir);
    const prefix = "2026.09.16_13-19-26_1.1.5.0.47426";
    for (const suffix of [
      "application_000.log",
      "backend_000.log",
      "errors_000.log",
      "files-checker_000.log",
      "output_000.log",
      "push-notifications_000.log",
      "spatial-audio_000.log",
    ]) {
      writeFileSync(join(sessionDir, `${prefix} ${suffix}`), "");
    }

    expect(findLogFile(sessionDir, "application")).toBe(join(sessionDir, `${prefix} application_000.log`));
    expect(findLogFile(sessionDir, "pushNotifications")).toBe(
      join(sessionDir, `${prefix} push-notifications_000.log`)
    );
  });

  it("returns null when no matching file exists", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-logs-test-"));
    const sessionDir = join(tempDir, "empty-session");
    mkdirSync(sessionDir);

    expect(findLogFile(sessionDir, "application")).toBeNull();
  });

  it("returns null when the session directory does not exist", () => {
    expect(findLogFile(join(tmpdir(), "no-such-dir-" + Date.now()), "application")).toBeNull();
  });
});
