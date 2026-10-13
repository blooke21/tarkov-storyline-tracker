import { readFileSync } from "node:fs";
import { findLogFile } from "./discovery.js";
import { extractNotificationEvents } from "./notificationEvents.js";
import { extractRaidStartEvents } from "./raidStartEvents.js";
import type { ProgressStore } from "../progress/store.js";
import { DEFAULT_GAME_MODE, type GameMode } from "../tarkovData/gameMode.js";
import { extractModeMarkers, modeAt } from "./modeTimeline.js";

export interface ApplySessionResult {
  taskEventsApplied: number;
  raidEventsSeen: number;
}

const LAST_RAID_SEEN_KEY = "lastRaidSeenAt";

function readSafely(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

export interface ApplySessionOptions {
  /** The mode to file a quest event under when the logs can't say which one it was (default PvE). */
  fallbackMode?: GameMode;
}

export function applySessionToStore(sessionDir: string, store: ProgressStore, options: ApplySessionOptions = {}): ApplySessionResult {
  let taskEventsApplied = 0;
  let raidEventsSeen = 0;
  let latestRaidTimestamp: Date | null = null;
  const fallbackMode = options.fallbackMode ?? DEFAULT_GAME_MODE;

  // A quest message doesn't say which mode it came from, but the game's backend log shows which mode's
  // servers it was talking to at every moment; each event is filed under the mode it happened in.
  const backendPath = findLogFile(sessionDir, "backend");
  const markers = backendPath ? extractModeMarkers(readSafely(backendPath)) : [];
  // After a wipe (the player reset a character), anything logged before that
  // character's boundary belongs to the previous one and must not count.
  const boundaries = new Map<GameMode, Date | null>();
  const viewOf = (mode: GameMode): { view: ProgressStore; since: Date | null } => {
    const view = store.forMode(mode);
    if (!boundaries.has(mode)) {
      boundaries.set(mode, view.getProgressSince());
    }
    return { view, since: boundaries.get(mode) ?? null };
  };

  const notificationsPath = findLogFile(sessionDir, "pushNotifications");
  if (notificationsPath) {
    const text = readSafely(notificationsPath);
    for (const event of extractNotificationEvents(text)) {
      if (event.kind === "task") {
        const { view, since } = viewOf(modeAt(markers, event.occurredAt, fallbackMode));
        if (since && event.occurredAt < since) {
          continue;
        }
        view.recordEvent(event.taskId, event.status, event.occurredAt);
        taskEventsApplied++;
      } else {
        raidEventsSeen++;
        if (!latestRaidTimestamp || event.occurredAt > latestRaidTimestamp) {
          latestRaidTimestamp = event.occurredAt;
        }
      }
    }
  }

  const applicationPath = findLogFile(sessionDir, "application");
  if (applicationPath) {
    const text = readSafely(applicationPath);
    for (const event of extractRaidStartEvents(text)) {
      raidEventsSeen++;
      if (!latestRaidTimestamp || event.occurredAt > latestRaidTimestamp) {
        latestRaidTimestamp = event.occurredAt;
      }
    }
  }

  if (latestRaidTimestamp) {
    const previous = store.getMeta(LAST_RAID_SEEN_KEY);
    if (!previous || new Date(previous) < latestRaidTimestamp) {
      store.setMeta(LAST_RAID_SEEN_KEY, latestRaidTimestamp.toISOString());
    }
  }

  return { taskEventsApplied, raidEventsSeen };
}
