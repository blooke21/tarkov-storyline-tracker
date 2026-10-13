import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ProgressStore, runBackfill, parseGameMode } from "./index.js";
import type { GameMode } from "./index.js";

export interface WipeOptions {
  dbPath: string;
  logsRootDir: string;
  /** Tracking restarts from this moment; anything logged earlier is ignored. */
  since: Date;
  /** Which game mode's character was reset (default PvE). */
  mode?: GameMode;
}

export interface WipeResult {
  since: Date;
  /** How many task events from after the boundary were picked up from the logs. */
  tasksPickedUp: number;
}

/**
 * Starts progress tracking from scratch — for when the player resets their
 * character. Clears the stored progress, remembers the boundary so the wipe
 * survives restarts, then re-reads the logs so anything that happened after
 * the boundary (e.g. quests accepted a minute after the reset) is not lost.
 */
export function wipeProgress(options: WipeOptions): WipeResult {
  const store = new ProgressStore(options.dbPath, options.mode);
  try {
    store.resetProgress(options.since);
    const result = runBackfill(options.logsRootDir, store);
    return { since: options.since, tasksPickedUp: result.taskEventsApplied };
  } finally {
    store.close();
  }
}

/** Reads `--since <date/time>` from the command line; defaults to now. */
export function parseSinceArg(args: string[], now: Date = new Date()): Date {
  const index = args.indexOf("--since");
  if (index === -1) {
    return now;
  }
  const value = args[index + 1];
  const parsed = value ? new Date(value) : null;
  if (!value || !parsed || Number.isNaN(parsed.getTime())) {
    throw new Error(`--since needs a date and time like "2026-10-10 10:12" or an ISO timestamp, got "${value ?? ""}"`);
  }
  return parsed;
}

const isMainModule = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1] as string).href;

if (isMainModule) {
  try {
    const since = parseSinceArg(process.argv.slice(2));
    const dbPath = process.env.TARKOV_DB_PATH ?? join(process.cwd(), ".tarkov-progress.sqlite");
    const logsRootDir = process.env.TARKOV_LOGS_DIR ?? "C:\\Battlestate Games\\Escape from Tarkov\\Logs";
    const modeIndex = process.argv.indexOf("--mode");
    const mode = parseGameMode(modeIndex === -1 ? process.env.TARKOV_GAME_MODE : process.argv[modeIndex + 1]);
    const result = wipeProgress({ dbPath, logsRootDir, since, mode });
    console.log(`Wiped. Tracking now starts from ${result.since.toLocaleString()}.`);
    console.log(`Picked up ${result.tasksPickedUp} quest event(s) logged since then.`);
    console.log("If the tracker is running, that's all — it reads the same data. Close and reopen it if the numbers look stale.");
  } catch (error) {
    console.error("Wipe failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
