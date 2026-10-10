import { HttpError } from "./createServer.js";
import { collectTaskEvents } from "../logWatcher/collectEvents.js";
import type { TaskLogEvent } from "../logWatcher/collectEvents.js";
import { scanLogs, countStatuses } from "./scanApi.js";
import type { ScanReport, StatusCounts } from "./scanApi.js";
import type { ProgressStore, TaskStatus } from "../progress/store.js";
import type { TarkovTask } from "../tarkovData/types.js";

export interface WipeApiDeps {
  store: ProgressStore;
  logsRootDir: string;
  getTasks: () => TarkovTask[];
}

export interface EventSummary {
  at: string;
  taskId: string;
  name: string;
  status: TaskStatus;
}

export interface WipeOptionsResponse {
  /** When tracking was last reset to, if it ever was. */
  progressSince: string | null;
  /** What the tracker is counting right now. */
  current: StatusCounts;
  /** A best guess at when the new character started — the first action after the most recent pause. */
  suggestedSince: string | null;
  /** The most recent quest actions in the player's logs, newest first, to pick the reset moment from. */
  recentEvents: EventSummary[];
}

export interface WipePreviewResponse {
  since: string;
  willClear: StatusCounts;
  keptEvents: number;
  willTrack: Array<{ name: string; status: TaskStatus }>;
}

export interface WipeResultResponse {
  since: string;
  picked: number;
  /** The full log scan that runs right after the wipe, so the player can see nothing was missed. */
  scan: ScanReport;
}

const UNLISTED_QUEST_NAME = "Quest not in the quest list (e.g. an operational task)";
// A pause at least this long between two quest actions can plausibly be the
// player resetting their character.
const MIN_SUGGESTION_GAP_MS = 60_000;
const MAX_PREVIEW_QUESTS = 100;
// A few seconds of slack so a moment the player picked "just now" isn't
// rejected over a small clock difference.
const FUTURE_TOLERANCE_MS = 60_000;

function nameLookup(tasks: TarkovTask[]): (taskId: string) => string {
  const names = new Map(tasks.map((task) => [task.id, task.name]));
  return (taskId) => names.get(taskId) ?? UNLISTED_QUEST_NAME;
}

/**
 * The first event after the most recent pause (events are oldest-first), or
 * null if there's no pause. The *most recent* pause, not the longest: an old
 * long break (a night's sleep) would otherwise beat the short gap right
 * before the player's actual reset. It's only a suggestion — the player
 * confirms it on the double-check step.
 */
function suggestStart(events: TaskLogEvent[]): Date | null {
  for (let i = events.length - 1; i >= 1; i--) {
    const gap = events[i].occurredAt.getTime() - events[i - 1].occurredAt.getTime();
    if (gap >= MIN_SUGGESTION_GAP_MS) {
      return events[i].occurredAt;
    }
  }
  return null;
}

export function buildWipeOptions(deps: WipeApiDeps, recentLimit = 15): WipeOptionsResponse {
  const nameOf = nameLookup(deps.getTasks());
  const recent = collectTaskEvents(deps.logsRootDir).slice(-recentLimit);

  return {
    progressSince: deps.store.getProgressSince()?.toISOString() ?? null,
    current: countStatuses(deps.store.getAllStatuses()),
    suggestedSince: suggestStart(recent)?.toISOString() ?? null,
    recentEvents: [...recent].reverse().map((event) => ({
      at: event.occurredAt.toISOString(),
      taskId: event.taskId,
      name: nameOf(event.taskId),
      status: event.status,
    })),
  };
}

/** What a wipe from `since` would do — computed without changing anything. */
export function buildWipePreview(deps: WipeApiDeps, since: Date): WipePreviewResponse {
  const nameOf = nameLookup(deps.getTasks());
  const kept = collectTaskEvents(deps.logsRootDir).filter((event) => event.occurredAt >= since);

  const latestByTask = new Map<string, TaskStatus>();
  for (const event of kept) {
    latestByTask.set(event.taskId, event.status);
  }

  return {
    since: since.toISOString(),
    willClear: countStatuses(deps.store.getAllStatuses()),
    keptEvents: kept.length,
    willTrack: [...latestByTask]
      .slice(0, MAX_PREVIEW_QUESTS)
      .map(([taskId, status]) => ({ name: nameOf(taskId), status })),
  };
}

/** Clears the tracked progress, remembers `since`, then scans every log so everything after it is counted. */
export function performWipe(deps: WipeApiDeps, since: Date): WipeResultResponse {
  deps.store.resetProgress(since);
  const scan = scanLogs(deps);
  return { since: since.toISOString(), picked: scan.eventsCounted, scan };
}

/** Validates the `since` a request supplies. Anything unusable is the caller's mistake, hence 400. */
export function parseSince(raw: string | null, now: Date = new Date()): Date {
  if (!raw) {
    throw new HttpError(400, "since is required (an ISO date/time)");
  }
  const since = new Date(raw);
  if (Number.isNaN(since.getTime())) {
    throw new HttpError(400, `since must be an ISO date/time, got "${raw}"`);
  }
  if (since.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    throw new HttpError(400, "since is in the future — that would hide everything you do from now on");
  }
  return since;
}
