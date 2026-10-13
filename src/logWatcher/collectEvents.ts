import { readFileSync } from "node:fs";
import { listSessionFolders, findLogFile } from "./discovery.js";
import { extractNotificationEvents } from "./notificationEvents.js";
import { extractModeMarkers, modeAt } from "./modeTimeline.js";
import { DEFAULT_GAME_MODE, type GameMode } from "../tarkovData/gameMode.js";

export interface TaskLogEvent {
  taskId: string;
  status: "accepted" | "failed" | "completed";
  occurredAt: Date;
  traderId: string | null;
  /** The game mode it happened in, from the server the game was talking to at the time. */
  mode: GameMode;
}

export interface CollectOptions {
  /** Only events from this mode. */
  mode?: GameMode;
  /** The mode assumed when the logs can't say (default PvE). */
  fallbackMode?: GameMode;
}

/**
 * Every quest event in the player's log history, oldest first. Used for
 * showing the player what the logs say (e.g. when helping them pick the
 * moment they reset their character) — not for ongoing tracking, which goes
 * through applySessionToStore.
 */
export function collectTaskEvents(logsRootDir: string, options: CollectOptions = {}): TaskLogEvent[] {
  const events: TaskLogEvent[] = [];

  for (const session of listSessionFolders(logsRootDir)) {
    const path = findLogFile(session.path, "pushNotifications");
    if (!path) {
      continue;
    }
    let text: string;
    try {
      text = readFileSync(path, "utf-8");
    } catch {
      continue;
    }
    const backendPath = findLogFile(session.path, "backend");
    let markers: ReturnType<typeof extractModeMarkers> = [];
    if (backendPath) {
      try {
        markers = extractModeMarkers(readFileSync(backendPath, "utf-8"));
      } catch {
        markers = [];
      }
    }
    for (const event of extractNotificationEvents(text)) {
      if (event.kind === "task") {
        const mode = modeAt(markers, event.occurredAt, options.fallbackMode ?? DEFAULT_GAME_MODE);
        if (!options.mode || mode === options.mode) {
          events.push({ taskId: event.taskId, status: event.status, occurredAt: event.occurredAt, traderId: event.traderId, mode });
        }
      }
    }
  }

  events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  return events;
}
