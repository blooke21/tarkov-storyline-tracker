import { listSessionFolders } from "./discovery.js";
import { applySessionToStore } from "./applySession.js";
import type { ProgressStore } from "../progress/store.js";

export interface BackfillResult {
  sessionsProcessed: number;
  taskEventsApplied: number;
  raidEventsSeen: number;
}

export function runBackfill(logsRootDir: string, store: ProgressStore): BackfillResult {
  const sessions = listSessionFolders(logsRootDir);
  let taskEventsApplied = 0;
  let raidEventsSeen = 0;

  for (const session of sessions) {
    const result = applySessionToStore(session.path, store);
    taskEventsApplied += result.taskEventsApplied;
    raidEventsSeen += result.raidEventsSeen;
  }

  return { sessionsProcessed: sessions.length, taskEventsApplied, raidEventsSeen };
}
