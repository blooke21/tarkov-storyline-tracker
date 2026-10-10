import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type LogsSource = "TARKOV_LOGS_DIR" | "settings.json" | "BSG Launcher" | "common folders" | "default";

export interface LogsLocation {
  /** The Logs folder to read, or the best guess if none was found. */
  dir: string;
  /** True if that folder exists on this computer. */
  found: boolean;
  source: LogsSource;
  /** Every place that was looked at, for the "couldn't find it" message. */
  tried: string[];
}

export interface LocatorEnvironment {
  env?: NodeJS.ProcessEnv;
  /** Where the tracker keeps its saved data (it may hold a settings.json). */
  dataDir: string;
  isDirectory?: (path: string) => boolean;
  readText?: (path: string) => string | null;
  /** Drive letters to check, like ["C", "D"]. */
  drives?: string[];
}

export const DEFAULT_LOGS_DIR = "C:\\Battlestate Games\\Escape from Tarkov\\Logs";

function isDirectorySync(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readTextSync(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function jsonField(text: string | null, field: string): string | null {
  if (!text) {
    return null;
  }
  try {
    const value = (JSON.parse(text.replace(/^\uFEFF/, "")) as Record<string, unknown>)[field];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Finds the game's Logs folder without asking the player. In order: the
 * TARKOV_LOGS_DIR setting, a logsDir in the tracker's own settings.json, the
 * folder the BSG Launcher says games are installed in, then the usual
 * "Battlestate Games" folder on each drive. A setting that points nowhere is
 * reported rather than silently replaced, so a typo doesn't go unnoticed.
 */
export function findLogsDir(environment: LocatorEnvironment): LogsLocation {
  const env = environment.env ?? process.env;
  const isDirectory = environment.isDirectory ?? isDirectorySync;
  const readText = environment.readText ?? readTextSync;
  const tried: string[] = [];

  const check = (dir: string, source: LogsSource): LogsLocation | null => {
    tried.push(dir);
    return isDirectory(dir) ? { dir, found: true, source, tried } : null;
  };

  const fromEnv = env.TARKOV_LOGS_DIR?.trim();
  if (fromEnv) {
    return check(fromEnv, "TARKOV_LOGS_DIR") ?? { dir: fromEnv, found: false, source: "TARKOV_LOGS_DIR", tried };
  }

  const fromSettings = jsonField(readText(join(environment.dataDir, "settings.json")), "logsDir");
  if (fromSettings) {
    return check(fromSettings, "settings.json") ?? { dir: fromSettings, found: false, source: "settings.json", tried };
  }

  const launcherSettings = env.APPDATA ? join(env.APPDATA, "Battlestate Games", "BsgLauncher", "settings") : null;
  const gamesRoot = launcherSettings ? jsonField(readText(launcherSettings), "gamesRootDir") : null;
  if (gamesRoot) {
    const found = check(join(gamesRoot, "Escape from Tarkov", "Logs"), "BSG Launcher");
    if (found) {
      return found;
    }
  }

  for (const drive of environment.drives ?? ["C", "D", "E", "F", "G"]) {
    const found = check(`${drive}:\\Battlestate Games\\Escape from Tarkov\\Logs`, drive === "C" ? "default" : "common folders");
    if (found) {
      return found;
    }
  }

  return { dir: DEFAULT_LOGS_DIR, found: false, source: "default", tried };
}
