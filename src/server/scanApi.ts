import { collectTaskEvents } from "../logWatcher/collectEvents.js";
import { listSessionFolders, findLogFile } from "../logWatcher/discovery.js";
import { runBackfill } from "../logWatcher/backfill.js";
import type { ProgressStore, TaskStatus } from "../progress/store.js";
import type { TarkovTask } from "../tarkovData/types.js";

export interface ScanDeps {
  store: ProgressStore;
  logsRootDir: string;
  getTasks: () => TarkovTask[];
}

export interface StatusCounts {
  completed: number;
  accepted: number;
  failed: number;
}

export interface ScanChange {
  name: string;
  from: TaskStatus | null;
  to: TaskStatus;
}

export interface ScanReport {
  /** Game log folders found, and how many of them had a quest log to read. */
  logFolders: number;
  foldersWithQuestLog: number;
  /** Every quest event in the logs, and how many count (those since the last reset). */
  eventsInLogs: number;
  eventsCounted: number;
  firstEventAt: string | null;
  lastEventAt: string | null;
  progressSince: string | null;
  /** What the tracker now holds. */
  tracked: StatusCounts;
  /** What the scan had to fix: quests the logs knew about that the tracker had missed or had out of date. */
  added: number;
  changed: number;
  changes: ScanChange[];
  /** Quests the tracker remembers that the current logs no longer show (the game deletes old logs). Kept, not removed. */
  keptFromEarlier: number;
  /** Quest ids in the logs that aren't in the quest list (operational tasks and the like). */
  notInQuestList: number;
  /** Quests you've started whose required earlier quest has no completion in the logs. Worth a look, not changed. */
  missingEarlier: Array<{ name: string; neededBy: string }>;
  missingEarlierTotal: number;
}

const MAX_LISTED = 10;
const UNLISTED = "Quest not in the quest list (e.g. an operational task)";

export function countStatuses(statuses: Map<string, TaskStatus>): StatusCounts {
  const counts: StatusCounts = { completed: 0, accepted: 0, failed: 0 };
  for (const status of statuses.values()) {
    counts[status]++;
  }
  return counts;
}

/**
 * Reads every game log from scratch and brings the tracker in line with it:
 * quests the logs show that the tracker missed are added, out-of-date ones are
 * corrected. It never removes anything — the game deletes old logs, and the
 * tracker's own record of those quests would be lost with them.
 */
export function scanLogs(deps: ScanDeps): ScanReport {
  const tasks = deps.getTasks();
  const nameOf = new Map(tasks.map((task) => [task.id, task.name]));
  const before = deps.store.getAllStatuses();

  runBackfill(deps.logsRootDir, deps.store);

  const after = deps.store.getAllStatuses();
  const since = deps.store.getProgressSince();
  const events = collectTaskEvents(deps.logsRootDir, { mode: deps.store.mode });
  const counted = since ? events.filter((event) => event.occurredAt >= since) : events;

  const fromLogs = new Set(counted.map((event) => event.taskId));
  const changes: ScanChange[] = [];
  let added = 0;
  let changed = 0;
  for (const [taskId, status] of after) {
    const was = before.get(taskId) ?? null;
    if (was === status) {
      continue;
    }
    if (was === null) {
      added++;
    } else {
      changed++;
    }
    changes.push({ name: nameOf.get(taskId) ?? UNLISTED, from: was, to: status });
  }

  const missing = new Map<string, { name: string; neededBy: string }>();
  for (const task of tasks) {
    const status = after.get(task.id);
    if (status !== "accepted" && status !== "completed") {
      continue;
    }
    for (const requirement of task.taskRequirements) {
      const needsCompletion = requirement.status.includes("complete") && !requirement.status.includes("failed");
      const earlier = requirement.task.id;
      if (needsCompletion && after.get(earlier) !== "completed" && nameOf.has(earlier)) {
        missing.set(earlier, { name: nameOf.get(earlier)!, neededBy: task.name });
      }
    }
  }

  const sessions = listSessionFolders(deps.logsRootDir);
  return {
    logFolders: sessions.length,
    foldersWithQuestLog: sessions.filter((session) => findLogFile(session.path, "pushNotifications")).length,
    eventsInLogs: events.length,
    eventsCounted: counted.length,
    firstEventAt: events[0]?.occurredAt.toISOString() ?? null,
    lastEventAt: events.at(-1)?.occurredAt.toISOString() ?? null,
    progressSince: since?.toISOString() ?? null,
    tracked: countStatuses(after),
    added,
    changed,
    changes: changes.slice(0, MAX_LISTED),
    keptFromEarlier: [...after.keys()].filter((taskId) => !fromLogs.has(taskId)).length,
    notInQuestList: [...fromLogs].filter((taskId) => !nameOf.has(taskId)).length,
    missingEarlier: [...missing.values()].slice(0, MAX_LISTED),
    missingEarlierTotal: missing.size,
  };
}
