import { readFileSync, statSync } from "node:fs";
import { findLogFile, listSessionFolders } from "../logWatcher/discovery.js";
import { extractNotificationEvents } from "../logWatcher/notificationEvents.js";
import type { ProgressStore } from "../progress/store.js";
import type { TarkovTask } from "../tarkovData/types.js";

export interface OperationalDeps {
  store: ProgressStore;
  logsRootDir: string;
  getTasks: () => TarkovTask[];
  now?: () => Date;
}

export interface OperationalEntry {
  at: string;
  trader: string | null;
  status: "completed" | "failed";
}

export interface OperationalResponse {
  /** Completed operational tasks: since midnight, in the last 7 days, and since the last reset. */
  completed: { today: number; lastWeek: number; sinceReset: number };
  failedSinceReset: number;
  /** The newest ones first. */
  recent: OperationalEntry[];
}

interface ParsedEvent {
  taskId: string;
  status: "accepted" | "failed" | "completed";
  occurredAt: Date;
  traderId: string | null;
}

const RECENT_LIMIT = 12;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Parsed events per log file, kept until the file changes: the game only ever appends to the newest log,
// so asking again every minute re-reads one file instead of the whole history.
const parsedFiles = new Map<string, { signature: string; events: ParsedEvent[] }>();

function eventsOf(path: string): ParsedEvent[] {
  let signature: string;
  try {
    const stats = statSync(path);
    signature = `${stats.size}:${stats.mtimeMs}`;
  } catch {
    return [];
  }
  const cached = parsedFiles.get(path);
  if (cached?.signature === signature) {
    return cached.events;
  }
  let events: ParsedEvent[] = [];
  try {
    for (const event of extractNotificationEvents(readFileSync(path, "utf-8"))) {
      if (event.kind === "task") {
        events.push({ taskId: event.taskId, status: event.status, occurredAt: event.occurredAt, traderId: event.traderId });
      }
    }
  } catch {
    events = [];
  }
  parsedFiles.set(path, { signature, events });
  return events;
}

const sameLocalDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * Operational (daily and weekly) tasks the player finished, from the game's logs. They aren't in the quest
 * data, and the game logs only that one was completed or failed — not what it was, and not when it was accepted —
 * so this is a count and a list, nothing more. Anything in the logs the quest list doesn't have counts.
 */
export function buildOperationalResponse(deps: OperationalDeps): OperationalResponse {
  const now = (deps.now ?? (() => new Date()))();
  const tasks = deps.getTasks();
  const listed = new Set(tasks.map((task) => task.id));
  const traderNames = new Map(tasks.map((task) => [task.trader.id, task.trader.name]));
  const since = deps.store.getProgressSince();

  const entries: Array<{ at: Date; trader: string | null; status: "completed" | "failed" }> = [];
  for (const session of listSessionFolders(deps.logsRootDir)) {
    const path = findLogFile(session.path, "pushNotifications");
    if (!path) {
      continue;
    }
    for (const event of eventsOf(path)) {
      if (listed.has(event.taskId) || (event.status !== "completed" && event.status !== "failed")) {
        continue;
      }
      if (since && event.occurredAt < since) {
        continue;
      }
      entries.push({ at: event.occurredAt, trader: event.traderId ? (traderNames.get(event.traderId) ?? null) : null, status: event.status });
    }
  }
  entries.sort((a, b) => b.at.getTime() - a.at.getTime());

  const completed = entries.filter((entry) => entry.status === "completed");
  return {
    completed: {
      today: completed.filter((entry) => sameLocalDay(entry.at, now)).length,
      lastWeek: completed.filter((entry) => now.getTime() - entry.at.getTime() <= WEEK_MS).length,
      sinceReset: completed.length,
    },
    failedSinceReset: entries.length - completed.length,
    recent: entries.slice(0, RECENT_LIMIT).map((entry) => ({ at: entry.at.toISOString(), trader: entry.trader, status: entry.status })),
  };
}
