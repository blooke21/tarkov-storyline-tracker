import { findLatestSession } from "./discovery.js";
import { applySessionToStore } from "./applySession.js";
import type { ProgressStore } from "../progress/store.js";

export interface LogTailerOptions {
  pollIntervalMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 3000;

export class LogTailer {
  private readonly logsRootDir: string;
  private readonly store: ProgressStore;
  private readonly pollIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(logsRootDir: string, store: ProgressStore, options: LogTailerOptions = {}) {
    this.logsRootDir = logsRootDir;
    this.store = store;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
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
    applySessionToStore(session.path, this.store);
    this.store.setMeta("lastWatcherPollAt", new Date().toISOString());
  }
}
