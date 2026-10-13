import Database from "better-sqlite3";
import { DEFAULT_GAME_MODE, type GameMode } from "../tarkovData/gameMode.js";

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

// Things that belong to the tracker as a whole rather than to one game mode's character.
const GLOBAL_META_KEYS = new Set(["lastWatcherPollAt", "lastRaidSeenAt", "viewMode"]);

/**
 * The player's saved progress. Each game mode (PvE, PvP, PvP Season) is a separate character, so everything
 * about a character is kept per mode: quest statuses, the reset boundary, story chapters, pins, prestige.
 *
 * A store is "looking at" one mode (`mode`); `forMode` gives another view of the same database, which is how
 * events from the logs are filed under the mode they belong to. PvE's saved values keep their original,
 * unprefixed keys, so progress saved before modes existed is simply PvE's.
 */
export class ProgressStore {
  private readonly db: Database.Database;
  private readonly ownsDatabase: boolean;
  /** The mode this store is currently reading and writing. */
  mode: GameMode;

  constructor(source: string | Database.Database, mode: GameMode = DEFAULT_GAME_MODE) {
    this.mode = mode;
    if (typeof source === "string") {
      this.db = new Database(source);
      this.ownsDatabase = true;
      this.createSchema();
    } else {
      this.db = source;
      this.ownsDatabase = false;
    }
  }

  private createSchema(): void {
    const columns = this.db.prepare(`PRAGMA table_info(task_progress)`).all() as Array<{ name: string }>;
    const createTable = (name: string): void => {
      this.db.exec(`
        CREATE TABLE ${name} (
          mode TEXT NOT NULL DEFAULT 'pve',
          task_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('accepted', 'completed', 'failed')),
          updated_at TEXT NOT NULL,
          PRIMARY KEY (mode, task_id)
        )
      `);
    };

    if (columns.length === 0) {
      createTable("task_progress");
    } else if (!columns.some((column) => column.name === "mode")) {
      // A database from before game modes existed: everything in it belongs to PvE.
      this.db.transaction(() => {
        createTable("task_progress_with_mode");
        this.db.exec(`
          INSERT INTO task_progress_with_mode (mode, task_id, status, updated_at)
          SELECT 'pve', task_id, status, updated_at FROM task_progress
        `);
        this.db.exec(`DROP TABLE task_progress`);
        this.db.exec(`ALTER TABLE task_progress_with_mode RENAME TO task_progress`);
      })();
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS store_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
  }

  /** Another view of the same saved data, looking at a different mode. Closing a view doesn't close the database. */
  forMode(mode: GameMode): ProgressStore {
    return new ProgressStore(this.db, mode);
  }

  /** Switches which mode this store reads and writes. */
  setMode(mode: GameMode): void {
    this.mode = mode;
  }

  private metaKey(key: string): string {
    return GLOBAL_META_KEYS.has(key) || this.mode === DEFAULT_GAME_MODE ? key : `${this.mode}:${key}`;
  }

  recordEvent(taskId: string, status: TaskStatus, occurredAt: Date = new Date()): void {
    this.db
      .prepare(
        `INSERT INTO task_progress (mode, task_id, status, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(mode, task_id) DO UPDATE SET
           status = excluded.status,
           updated_at = excluded.updated_at
         WHERE excluded.updated_at >= task_progress.updated_at`
      )
      .run(this.mode, taskId, status, occurredAt.toISOString());
  }

  getStatus(taskId: string): TaskStatus | null {
    const row = this.db
      .prepare(`SELECT status FROM task_progress WHERE mode = ? AND task_id = ?`)
      .get(this.mode, taskId) as ProgressRow | undefined;
    return row ? row.status : null;
  }

  getAllStatuses(): Map<string, TaskStatus> {
    const rows = this.db.prepare(`SELECT task_id, status FROM task_progress WHERE mode = ?`).all(this.mode) as ProgressRow[];
    return new Map(rows.map((row) => [row.task_id, row.status]));
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO store_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(this.metaKey(key), value);
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM store_meta WHERE key = ?`).get(this.metaKey(key)) as MetaRow | undefined;
    return row ? row.value : null;
  }

  /**
   * Starts tracking from scratch, e.g. after the player resets their character. Forgets every recorded task
   * (and story-chapter progress and pins) in this mode and remembers `since`: from then on, log events older than
   * that moment are ignored. The boundary is what makes the wipe stick — without it, the next restart would
   * re-read the old logs and bring the previous character's progress straight back.
   */
  resetProgress(since: Date): void {
    const wipe = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM task_progress WHERE mode = ?`).run(this.mode);
      // A new character starts the story over too.
      this.db.prepare(`DELETE FROM store_meta WHERE key = ?`).run(this.metaKey(STORY_CHAPTERS_META_KEY));
      this.db.prepare(`DELETE FROM store_meta WHERE key = ?`).run(this.metaKey(PINNED_TASKS_META_KEY));
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
    if (this.ownsDatabase) {
      this.db.close();
    }
  }
}
