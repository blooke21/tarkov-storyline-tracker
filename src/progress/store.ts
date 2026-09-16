import Database from "better-sqlite3";

export type TaskStatus = "accepted" | "completed" | "failed";

interface ProgressRow {
  task_id: string;
  status: TaskStatus;
}

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

  close(): void {
    this.db.close();
  }
}
