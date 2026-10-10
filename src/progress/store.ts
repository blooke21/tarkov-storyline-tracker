import Database from "better-sqlite3";

export type TaskStatus = "accepted" | "completed" | "failed";

interface ProgressRow {
  task_id: string;
  status: TaskStatus;
}

interface MetaRow {
  value: string;
}

const PROGRESS_SINCE_KEY = "progressSince";
/** Where the player's hand-kept story-chapter progress lives (see server/chaptersApi.ts). */
export const STORY_CHAPTERS_META_KEY = "storyChapterProgress";
/** The quests the player pinned in the dashboard (see server/pinsApi.ts). */
export const PINNED_TASKS_META_KEY = "pinnedTasks";

export class ProgressStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_progress (
        task_id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK(status IN ('accepted', 'completed', 'failed')),
        updated_at TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS store_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
  }

  recordEvent(taskId: string, status: TaskStatus, occurredAt: Date = new Date()): void {
    this.db
      .prepare(
        `INSERT INTO task_progress (task_id, status, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(task_id) DO UPDATE SET
           status = excluded.status,
           updated_at = excluded.updated_at
         WHERE excluded.updated_at >= task_progress.updated_at`
      )
      .run(taskId, status, occurredAt.toISOString());
  }

  getStatus(taskId: string): TaskStatus | null {
    const row = this.db.prepare(`SELECT status FROM task_progress WHERE task_id = ?`).get(taskId) as
      | ProgressRow
      | undefined;
    return row ? row.status : null;
  }

  getAllStatuses(): Map<string, TaskStatus> {
    const rows = this.db.prepare(`SELECT task_id, status FROM task_progress`).all() as ProgressRow[];
    return new Map(rows.map((row) => [row.task_id, row.status]));
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO store_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, value);
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM store_meta WHERE key = ?`).get(key) as MetaRow | undefined;
    return row ? row.value : null;
  }

  /**
   * Starts tracking from scratch, e.g. after the player resets their
   * character. Forgets every recorded task (and story-chapter progress and pins) and remembers `since`: from then
   * on, log events older than that moment are ignored. The boundary is what
   * makes the wipe stick — without it, the next restart would re-read the old
   * logs and bring the previous character's progress straight back.
   */
  resetProgress(since: Date): void {
    const wipe = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM task_progress`).run();
      // A new character starts the story over too.
      this.db.prepare(`DELETE FROM store_meta WHERE key = ?`).run(STORY_CHAPTERS_META_KEY);
      this.db.prepare(`DELETE FROM store_meta WHERE key = ?`).run(PINNED_TASKS_META_KEY);
      this.setMeta(PROGRESS_SINCE_KEY, since.toISOString());
    });
    wipe();
  }

  /** The moment tracking was last reset to, or null if it never has been. */
  getProgressSince(): Date | null {
    const value = this.getMeta(PROGRESS_SINCE_KEY);
    if (!value) {
      return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  close(): void {
    this.db.close();
  }
}
