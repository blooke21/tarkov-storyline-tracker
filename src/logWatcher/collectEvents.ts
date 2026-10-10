import { readFileSync } from "node:fs";
import { listSessionFolders, findLogFile } from "./discovery.js";
import { extractNotificationEvents } from "./notificationEvents.js";

export interface TaskLogEvent {
  taskId: string;
  status: "accepted" | "failed" | "completed";
  occurredAt: Date;
}

/**
 * Every quest event in the player's log history, oldest first. Used for
 * showing the player what the logs say (e.g. when helping them pick the
 * moment they reset their character) — not for ongoing tracking, which goes
 * through applySessionToStore.
 */
export function collectTaskEvents(logsRootDir: string): TaskLogEvent[] {
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
    for (const event of extractNotificationEvents(text)) {
      if (event.kind === "task") {
        events.push({ taskId: event.taskId, status: event.status, occurredAt: event.occurredAt });
      }
    }
  }

  events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  return events;
}
