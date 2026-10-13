import { findLatestSession } from "./discovery.js";
import { applySessionToStore } from "./applySession.js";
import type { GameMode } from "../tarkovData/gameMode.js";
import type { ProgressStore } from "../progress/store.js";

export interface LogTailerOptions {
  pollIntervalMs?: number;
  /** The mode to file a quest event under when the logs can't say which one it was. */
  fallbackMode?: GameMode;
}

const DEFAULT_POLL_INTERVAL_MS = 3000;

export class LogTailer {
  private readonly logsRootDir: string;
  private readonly store: ProgressStore;
  private readonly pollIntervalMs: number;
  private readonly fallbackMode: GameMode | undefined;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(logsRootDir: string, store: ProgressStore, options: LogTailerOptions = {}) {
    this.logsRootDir = logsRootDir;
    this.store = store;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.fallbackMode = options.fallbackMode;
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.poll();
    this.timer = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  poll(): void {
    const session = findLatestSession(this.logsRootDir);
    if (!session) {
      return;
    }
    try {
      applySessionToStore(session.path, this.store, { fallbackMode: this.fallbackMode });
    } catch {
      // A transient read failure (file deleted/locked mid-poll) should
      // not crash the process — just try again on the next tick.
      return;
    }
    this.store.setMeta("lastWatcherPollAt", new Date().toISOString());
  }
}
