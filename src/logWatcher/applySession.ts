import { readFileSync } from "node:fs";
import { findLogFile } from "./discovery.js";
import { extractNotificationEvents } from "./notificationEvents.js";
import { extractRaidStartEvents } from "./raidStartEvents.js";
import type { ProgressStore } from "../progress/store.js";

export interface ApplySessionResult {
  taskEventsApplied: number;
  raidEventsSeen: number;
}

const LAST_RAID_SEEN_KEY = "lastRaidSeenAt";

export function applySessionToStore(sessionDir: string, store: ProgressStore): ApplySessionResult {
  let taskEventsApplied = 0;
  let raidEventsSeen = 0;
  let latestRaidTimestamp: Date | null = null;

  const notificationsPath = findLogFile(sessionDir, "pushNotifications");
  if (notificationsPath) {
    const text = readFileSync(notificationsPath, "utf-8");
    for (const event of extractNotificationEvents(text)) {
      if (event.kind === "task") {
        store.recordEvent(event.taskId, event.status, event.occurredAt);
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
    const text = readFileSync(applicationPath, "utf-8");
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
