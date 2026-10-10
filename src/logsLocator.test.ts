import { describe, it, expect } from "vitest";
import { findLogsDir, DEFAULT_LOGS_DIR } from "./logsLocator.js";

const LAUNCHER_SETTINGS = "C:\\Users\\Pat\\AppData\\Roaming\\Battlestate Games\\BsgLauncher\\settings";

function locate(options: { existing?: string[]; files?: Record<string, string>; env?: NodeJS.ProcessEnv; drives?: string[] }) {
  const existing = new Set(options.existing ?? []);
  return findLogsDir({
    env: { APPDATA: "C:\\Users\\Pat\\AppData\\Roaming", ...options.env },
    dataDir: "C:\\Tracker\\data",
    isDirectory: (path) => existing.has(path),
    readText: (path) => options.files?.[path] ?? null,
    drives: options.drives ?? ["C", "D"],
  });
}

describe("findLogsDir", () => {
  it("uses TARKOV_LOGS_DIR first", () => {
    const result = locate({ env: { TARKOV_LOGS_DIR: "E:\\Games\\EFT\\Logs" }, existing: ["E:\\Games\\EFT\\Logs", DEFAULT_LOGS_DIR] });

    expect(result).toMatchObject({ dir: "E:\\Games\\EFT\\Logs", found: true, source: "TARKOV_LOGS_DIR" });
  });

  it("reports a setting that points nowhere instead of quietly using something else", () => {
    const result = locate({ env: { TARKOV_LOGS_DIR: "Z:\\typo" }, existing: [DEFAULT_LOGS_DIR] });

    expect(result).toMatchObject({ dir: "Z:\\typo", found: false, source: "TARKOV_LOGS_DIR" });
  });

  it("uses a logsDir from the tracker's settings.json, tolerating a byte-order mark", () => {
    const result = locate({
      existing: ["F:\\EFT\\Logs"],
      files: { "C:\\Tracker\\data\\settings.json": '\uFEFF{ "logsDir": "F:\\\\EFT\\\\Logs" }' },
    });

    expect(result).toMatchObject({ dir: "F:\\EFT\\Logs", found: true, source: "settings.json" });
  });

  it("ignores a settings.json that isn't usable", () => {
    const result = locate({ existing: [DEFAULT_LOGS_DIR], files: { "C:\\Tracker\\data\\settings.json": "{not json" } });

    expect(result.source).toBe("default");
  });

  it("follows the BSG Launcher's games folder, wherever the player put it", () => {
    const result = locate({
      existing: ["D:\\Games\\Escape from Tarkov\\Logs"],
      files: { [LAUNCHER_SETTINGS]: '{ "gamesRootDir": "D:\\\\Games" }' },
    });

    expect(result).toMatchObject({ dir: "D:\\Games\\Escape from Tarkov\\Logs", found: true, source: "BSG Launcher" });
  });

  it("falls back to the usual folder on each drive", () => {
    expect(locate({ existing: [DEFAULT_LOGS_DIR] })).toMatchObject({ dir: DEFAULT_LOGS_DIR, found: true, source: "default" });
    expect(locate({ existing: ["D:\\Battlestate Games\\Escape from Tarkov\\Logs"] })).toMatchObject({
      dir: "D:\\Battlestate Games\\Escape from Tarkov\\Logs",
      found: true,
      source: "common folders",
    });
  });

  it("says nothing was found, listing where it looked, and still names the default", () => {
    const result = locate({
      files: { [LAUNCHER_SETTINGS]: '{ "gamesRootDir": "D:\\\\Games" }' },
    });

    expect(result).toMatchObject({ dir: DEFAULT_LOGS_DIR, found: false });
    expect(result.tried).toEqual([
      "D:\\Games\\Escape from Tarkov\\Logs",
      "C:\\Battlestate Games\\Escape from Tarkov\\Logs",
      "D:\\Battlestate Games\\Escape from Tarkov\\Logs",
    ]);
  });
});
