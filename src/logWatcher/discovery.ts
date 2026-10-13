import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface SessionInfo {
  path: string;
  folderName: string;
  timestamp: Date;
}

// Real EFT session folders look like "log_2026.09.16_13-19-26_1.1.5.0.47426"
// (date, time with a single- or double-digit hour, then a version suffix
// this project doesn't need to parse).
const SESSION_FOLDER_PATTERN = /^log_(\d{4})\.(\d{2})\.(\d{2})_(\d{1,2})-(\d{2})-(\d{2})_/;

export function parseSessionFolderName(folderName: string): Date | null {
  const match = SESSION_FOLDER_PATTERN.exec(folderName);
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

export function listSessionFolders(logsRootDir: string): SessionInfo[] {
  let entries: string[];
  try {
    entries = readdirSync(logsRootDir);
  } catch {
    return [];
  }

  const sessions: SessionInfo[] = [];
  for (const folderName of entries) {
    const timestamp = parseSessionFolderName(folderName);
    if (!timestamp) {
      continue;
    }
    const path = join(logsRootDir, folderName);
    try {
      if (!statSync(path).isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }
    sessions.push({ path, folderName, timestamp });
  }

  sessions.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return sessions;
}

export function findLatestSession(logsRootDir: string): SessionInfo | null {
  const sessions = listSessionFolders(logsRootDir);
  return sessions.length > 0 ? sessions[sessions.length - 1] : null;
}

export type LogFileKind = "application" | "pushNotifications" | "backend";

// Real EFT log filenames carry a timestamp+version prefix before the type
// name (e.g. "2026.09.16_13-19-26_1.1.5.0.47426 application_000.log"), so
// matching must be by suffix, not exact filename.
const LOG_FILE_SUFFIXES: Record<LogFileKind, string> = {
  application: "application_000.log",
  pushNotifications: "push-notifications_000.log",
  backend: "backend_000.log",
};

export function findLogFile(sessionDir: string, kind: LogFileKind): string | null {
  let entries: string[];
  try {
    entries = readdirSync(sessionDir);
  } catch {
    return null;
  }

  const suffix = LOG_FILE_SUFFIXES[kind].toLowerCase();
  const match = entries.find((name) => name.toLowerCase().endsWith(suffix));
  return match ? join(sessionDir, match) : null;
}
