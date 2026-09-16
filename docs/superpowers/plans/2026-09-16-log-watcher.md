# Log Watcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically detect Escape from Tarkov quest progress (accepted/completed/failed) and raid boundaries by tailing the game's own local log files, and apply that progress to Plan 1's `ProgressStore` — with a backfill mode for history that predates the watcher, and a live-tail mode for ongoing play.

**Architecture:** A small pipeline of pure, independently-testable functions — session/file discovery, a log-line tokenizer, and two event extractors (quest/task events from the notifications log, raid-start events from the application log) — composed by one "apply a session's events to the store" function that both a one-shot backfill runner and a polling live-tail watcher reuse. No new external dependencies; everything is built on Node's `fs` and the `ProgressStore` from Plan 1.

**Tech Stack:** Node.js >= 20, TypeScript (strict mode, ESM/NodeNext), Vitest. Same toolchain as Plan 1 — no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-16-tarkov-storyline-tracker-design.md`

## How this plan was grounded in real data

Unlike a typical "read the vendor's docs" plan, EFT's log format has **no
official documentation** — the only prior art is the open-source tool
[TarkovMonitor](https://github.com/the-hideout/TarkovMonitor) (GPLv3,
C#), which was researched for its *technique* (which files to watch,
roughly what to look for), not copied for its code. That research alone
left real gaps: no confirmed example of an actual quest-status JSON
payload, and an open question about whether raid outcome (survived vs.
died) is even observable from these logs.

This plan closes those gaps directly: **Escape from Tarkov is installed
on the machine this plan was written on**, with over a year of the
user's own real log history at `C:\Battlestate Games\Escape from
Tarkov\Logs\`. Every format, regex, and JSON shape in this plan was
checked against that real data before being written down — not
inferred from someone else's source code. Specifically confirmed:

- The log directory structure, session-folder naming, and per-file
  naming convention (all real folder/file names quoted below are
  copied verbatim from this machine's actual `Logs\` directory).
- The exact log-line prefix format currently in use:
  `date time.mmm|version|level|logType|message` — confirmed across
  every session from November 2025 through today. (An older format
  without the version field, documented only in TarkovMonitor's issue
  history and never observed on this machine, is kept as a defensive
  fallback in the tokenizer — see Task 2.)
  **Correction (post-launch fix wave):** a third variant — the current
  format's fields WITH a timezone offset also present after the time —
  was later found on this machine (1,841 real lines, Nov 2025 builds
  `1.0.0.0.41760`/`.41771`). It is not the older version-less format
  described above; it is now handled by making the offset optional in
  `CURRENT_FORMAT` rather than being "never observed."
- Real quest-accepted (`type: 10`), quest-failed (`type: 11`), and
  quest-completed (`type: 12`) notification payloads, pulled directly
  from this user's own log history (task/item template IDs kept as-is
  since they're public game data; the user's own profile/dialog IDs
  replaced with placeholders since they're not needed for the fixture
  to be real).
- The real raid-start line sequence and its exact `Location:`/
  `shortId:`/`RaidMode:` fields, from an actual multi-raid play
  session.
- That `UserMatchOver`'s `status` field is **always** `"Free"`
  regardless of how the raid ended — confirming the design spec's
  open risk that raid outcome (survived/died/MIA) is not observable
  from these logs at all. This plan does not attempt to derive it.

## Global Constraints

- No cloud backend, no accounts, no data leaving the machine (spec:
  local-only architecture). All log reading is local filesystem access.
- Windows is the only supported target platform — this plan's file
  discovery reads a real Windows install path structure; use
  `node:path`'s `join` throughout rather than hardcoded separators.
- TypeScript strict mode throughout.
- **Parsing must fail soft, never throw, on any line or JSON block that
  doesn't match an expected shape** (spec: "parser skips unrecognized
  lines rather than crashing"). Every parsing function in this plan
  returns `null`/skips rather than throwing on malformed input — this is
  non-negotiable given BSG can and has changed the log format before
  (see the Design note in Task 2).
- Do not attempt to derive raid outcome (survived/died/MIA) — confirmed
  above that the only candidate signal (`UserMatchOver.status`) does not
  carry that information. Raid tracking in this plan is limited to
  start/end timestamps and map name, matching the spec's stated scope
  (bookkeeping, not raid analytics).
- Reuse `ProgressStore.recordEvent`'s existing idempotent upsert (the
  `WHERE excluded.updated_at >= task_progress.updated_at` guard from
  Plan 1) rather than adding new deduplication logic — it already makes
  re-applying the same event harmless, which this plan's live-tail
  design (Task 7) depends on.

---

### Task 1: Session and log file discovery

**Files:**
- Create: `src/logWatcher/discovery.ts`
- Test: `src/logWatcher/discovery.test.ts`

**Interfaces:**
- Consumes: nothing (first task of this plan).
- Produces:
  - `SessionInfo` interface `{ path: string; folderName: string; timestamp: Date }`.
  - `parseSessionFolderName(folderName: string): Date | null`.
  - `listSessionFolders(logsRootDir: string): SessionInfo[]` (oldest → newest; returns `[]` if the directory doesn't exist or has no matching folders).
  - `findLatestSession(logsRootDir: string): SessionInfo | null`.
  - `LogFileKind` type: `"application" | "pushNotifications"`.
  - `findLogFile(sessionDir: string, kind: LogFileKind): string | null` (absolute path, or `null` if no matching file exists in that directory).

- [ ] **Step 1: Write the failing test**

Create `src/logWatcher/discovery.test.ts`. The folder and file names below
are copied verbatim from this project's real EFT installation's `Logs\`
directory:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSessionFolderName, listSessionFolders, findLatestSession, findLogFile } from "./discovery.js";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("parseSessionFolderName", () => {
  it("parses a real session folder name into its timestamp", () => {
    const result = parseSessionFolderName("log_2026.09.16_13-19-26_1.1.5.0.47426");
    expect(result).toEqual(new Date(2026, 8, 16, 13, 19, 26));
  });

  it("parses a single-digit hour correctly", () => {
    const result = parseSessionFolderName("log_2025.11.16_0-28-27_1.0.0.0.41760");
    expect(result).toEqual(new Date(2025, 10, 16, 0, 28, 27));
  });

  it("returns null for a folder name that isn't a session folder", () => {
    expect(parseSessionFolderName("crash_reports")).toBeNull();
  });
});

describe("listSessionFolders", () => {
  it("returns matching session folders sorted oldest to newest, ignoring non-session entries", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-logs-test-"));
    mkdirSync(join(tempDir, "log_2026.09.16_13-19-26_1.1.5.0.47426"));
    mkdirSync(join(tempDir, "log_2025.11.16_0-28-27_1.0.0.0.41760"));
    mkdirSync(join(tempDir, "not_a_session_folder"));
    writeFileSync(join(tempDir, "log_2026.01.01_9-00-00_1.0.0.0.1.txt"), "not a directory");

    const sessions = listSessionFolders(tempDir);

    expect(sessions.map((s) => s.folderName)).toEqual([
      "log_2025.11.16_0-28-27_1.0.0.0.41760",
      "log_2026.09.16_13-19-26_1.1.5.0.47426",
    ]);
  });

  it("returns an empty array when the directory does not exist", () => {
    expect(listSessionFolders(join(tmpdir(), "does-not-exist-" + Date.now()))).toEqual([]);
  });
});

describe("findLatestSession", () => {
  it("returns the most recent session", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-logs-test-"));
    mkdirSync(join(tempDir, "log_2025.11.16_0-28-27_1.0.0.0.41760"));
    mkdirSync(join(tempDir, "log_2026.09.16_13-19-26_1.1.5.0.47426"));

    const latest = findLatestSession(tempDir);

    expect(latest?.folderName).toBe("log_2026.09.16_13-19-26_1.1.5.0.47426");
  });

  it("returns null when there are no sessions", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-logs-test-"));
    expect(findLatestSession(tempDir)).toBeNull();
  });
});

describe("findLogFile", () => {
  it("finds the application and push-notifications logs among real-shaped sibling files, ignoring the rest", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-logs-test-"));
    const sessionDir = join(tempDir, "log_2026.09.16_13-19-26_1.1.5.0.47426");
    mkdirSync(sessionDir);
    const prefix = "2026.09.16_13-19-26_1.1.5.0.47426";
    for (const suffix of [
      "application_000.log",
      "backend_000.log",
      "errors_000.log",
      "files-checker_000.log",
      "output_000.log",
      "push-notifications_000.log",
      "spatial-audio_000.log",
    ]) {
      writeFileSync(join(sessionDir, `${prefix} ${suffix}`), "");
    }

    expect(findLogFile(sessionDir, "application")).toBe(join(sessionDir, `${prefix} application_000.log`));
    expect(findLogFile(sessionDir, "pushNotifications")).toBe(
      join(sessionDir, `${prefix} push-notifications_000.log`)
    );
  });

  it("returns null when no matching file exists", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-logs-test-"));
    const sessionDir = join(tempDir, "empty-session");
    mkdirSync(sessionDir);

    expect(findLogFile(sessionDir, "application")).toBeNull();
  });

  it("returns null when the session directory does not exist", () => {
    expect(findLogFile(join(tmpdir(), "no-such-dir-" + Date.now()), "application")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/logWatcher/discovery.test.ts`
Expected: FAIL — `Cannot find module './discovery.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/logWatcher/discovery.ts`:

```ts
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

export type LogFileKind = "application" | "pushNotifications";

// Real EFT log filenames carry a timestamp+version prefix before the type
// name (e.g. "2026.09.16_13-19-26_1.1.5.0.47426 application_000.log"), so
// matching must be by suffix, not exact filename.
const LOG_FILE_SUFFIXES: Record<LogFileKind, string> = {
  application: "application_000.log",
  pushNotifications: "push-notifications_000.log",
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/logWatcher/discovery.test.ts`
Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/logWatcher/discovery.ts src/logWatcher/discovery.test.ts
git commit -m "Add EFT log session and file discovery

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Log line tokenizer

**Files:**
- Create: `src/logWatcher/logLine.ts`
- Test: `src/logWatcher/logLine.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ParsedLogLine` interface `{ date: string; time: string; version: string | null; level: string; logType: string; message: string }`.
  - `parseLogLine(rawLine: string): ParsedLogLine | null`.
  - `logLineTimestamp(line: ParsedLogLine): Date` (combines `date` + `time` as local time — log lines carry no timezone info in the current format).

**Design note — why two formats:** every real log line on this machine
(spanning November 2025 to today, three different game versions) uses
`date time|version|level|logType|message`. TarkovMonitor's issue #136
documents an older format without the version field and with a UTC
offset on the timestamp instead — never observed here, but since it's
evidence the format has changed before, this tokenizer treats it as a
defensive fallback rather than assuming the current format is permanent.
If a line matches neither format, `parseLogLine` returns `null` — per
the Global Constraints, callers must treat that as "skip this line," not
an error.

**Correction (post-launch fix wave):** "every real log line... uses
[the no-offset format]" above is now known false — 1,841 real lines on
this machine (Nov 2025 builds `1.0.0.0.41760`/`.41771`) combine the
current format's version field WITH a timezone offset after the time,
a variant this design note didn't anticipate. It was previously
mis-parsed by falling through to the version-less legacy branch below.
Fixed by making the offset optional in `CURRENT_FORMAT` so it's tried
first and matches correctly, rather than adding a third regex.

- [ ] **Step 1: Write the failing test**

Create `src/logWatcher/logLine.test.ts`. Every "real line" below is
copied verbatim from this project's actual EFT log files (only the
embedded profile ID in the last one is replaced with a placeholder,
since the exact value isn't relevant to what's being tested):

```ts
import { describe, it, expect } from "vitest";
import { parseLogLine, logLineTimestamp } from "./logLine.js";

describe("parseLogLine", () => {
  it("parses a real current-format line", () => {
    const line =
      "2026-09-16 13:20:11.174|1.1.5.0.47426|Info|push-notifications|NotificationManager: new params received url:  ws:wss://wsn-pve-01.escapefromtarkov.com/push/notifier/getwebsocket/abc";

    expect(parseLogLine(line)).toEqual({
      date: "2026-09-16",
      time: "13:20:11.174",
      version: "1.1.5.0.47426",
      level: "Info",
      logType: "push-notifications",
      message:
        "NotificationManager: new params received url:  ws:wss://wsn-pve-01.escapefromtarkov.com/push/notifier/getwebsocket/abc",
    });
  });

  it("keeps a pipe character that appears inside the message itself", () => {
    const line = "2025-11-30 16:36:00.234|1.0.0.1.41967|Info|push-notifications|Got notification | ChatMessageReceived";

    const parsed = parseLogLine(line);

    expect(parsed?.message).toBe("Got notification | ChatMessageReceived");
  });

  it("parses a real line containing a nested profileStatus payload", () => {
    const line =
      "2026-05-31 19:14:50.104|1.0.5.0.45272|Debug|application|TRACE-NetworkGameCreate profileStatus: 'Profileid: PLACEHOLDER, Status: Busy, RaidMode: Online, Ip: 172.98.82.131, Port: 17006, Location: TarkovStreets, Sid: session-id, GameMode: deathmatch, shortId: FW3C55'";

    const parsed = parseLogLine(line);

    expect(parsed?.logType).toBe("application");
    expect(parsed?.message).toContain("Location: TarkovStreets");
    expect(parsed?.message).toContain("shortId: FW3C55");
  });

  it("parses the legacy format (version-less, UTC-offset timestamp) as a defensive fallback", () => {
    const line = "2024-05-27 15:32:29.637 -04:00|Info|push-notifications|Got notification | ChatMessageReceived";

    expect(parseLogLine(line)).toEqual({
      date: "2024-05-27",
      time: "15:32:29.637",
      version: null,
      level: "Info",
      logType: "push-notifications",
      message: "Got notification | ChatMessageReceived",
    });
  });

  it("returns null for a line matching neither format", () => {
    expect(parseLogLine("this is not a log line at all")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseLogLine("")).toBeNull();
  });
});

describe("logLineTimestamp", () => {
  it("combines date and time into a local Date", () => {
    const timestamp = logLineTimestamp({
      date: "2026-09-16",
      time: "13:20:11.174",
      version: "1.1.5.0.47426",
      level: "Info",
      logType: "push-notifications",
      message: "",
    });

    expect(timestamp).toEqual(new Date(2026, 8, 16, 13, 20, 11, 174));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/logWatcher/logLine.test.ts`
Expected: FAIL — `Cannot find module './logLine.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/logWatcher/logLine.ts`:

```ts
export interface ParsedLogLine {
  date: string;
  time: string;
  version: string | null;
  level: string;
  logType: string;
  message: string;
}

// Verified against this project's own real EFT log files across three
// game versions (Nov 2025 - Sep 2026): "date time|version|level|logType|message".
const CURRENT_FORMAT = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}\.\d{3})\|([^|]+)\|([^|]+)\|([^|]+)\|(.*)$/;

// An older format without a version field, with a UTC offset on the
// timestamp instead: "date time tzoffset|level|logType|message". Documented
// in the-hideout/TarkovMonitor's issue #136 but never observed on this
// machine's own log history — kept as a defensive fallback only.
const LEGACY_FORMAT_WITH_TZ = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}\.\d{3}) [+-]\d{2}:\d{2}\|([^|]+)\|(.*)$/;

export function parseLogLine(rawLine: string): ParsedLogLine | null {
  const current = CURRENT_FORMAT.exec(rawLine);
  if (current) {
    const [, date, time, version, level, logType, message] = current;
    return { date, time, version, level, logType, message };
  }

  const legacy = LEGACY_FORMAT_WITH_TZ.exec(rawLine);
  if (legacy) {
    const [, date, time, level, rest] = legacy;
    const separatorIndex = rest.indexOf("|");
    if (separatorIndex === -1) {
      return null;
    }
    return {
      date,
      time,
      version: null,
      level,
      logType: rest.slice(0, separatorIndex),
      message: rest.slice(separatorIndex + 1),
    };
  }

  return null;
}

export function logLineTimestamp(line: ParsedLogLine): Date {
  return new Date(`${line.date}T${line.time}`);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/logWatcher/logLine.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/logWatcher/logLine.ts src/logWatcher/logLine.test.ts
git commit -m "Add EFT log line tokenizer, verified against real log files

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Quest/task and raid-end event extraction from the notifications log

**Files:**
- Create: `src/logWatcher/notificationEvents.ts`
- Test: `src/logWatcher/notificationEvents.test.ts`

**Interfaces:**
- Consumes: `parseLogLine`, `logLineTimestamp`, `ParsedLogLine` from `src/logWatcher/logLine.ts` (Task 2).
- Produces:
  - `NotificationEvent` discriminated union: `{ kind: "task"; taskId: string; status: "accepted" | "failed" | "completed"; occurredAt: Date } | { kind: "raidEnded"; occurredAt: Date; map: string | null }`.
  - `extractNotificationEvents(fileText: string): NotificationEvent[]` from `src/logWatcher/notificationEvents.ts`.

**Design note — real payload shapes:** the fixtures below are real
`ChatMessageReceived`/`UserMatchOver` notification bodies pulled from
this project's own push-notifications logs (task/item template IDs are
real, public Tarkov data; the user's own profile/dialog IDs are replaced
with placeholders). `message.type` 10/11/12 map to accepted/failed/
completed — confirmed directly, not inferred from source code. The task
ID is the first space-separated token of `message.templateId`, which in
real data is NOT simply `"<id> 0"` as TarkovMonitor's source implied —
real values look like `"<id> successMessageText <dialogId> 0"` or
`"<id> description"` or `"<id> failMessageText"`. Splitting on space and
taking the first token is correct regardless of the format of whatever
follows.

- [ ] **Step 1: Write the failing test**

Create `src/logWatcher/notificationEvents.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractNotificationEvents } from "./notificationEvents.js";

describe("extractNotificationEvents", () => {
  it("extracts a real quest-accepted event (message.type 10)", () => {
    const text = [
      "2025-12-24 12:34:41.858|1.0.0.1.41967|Info|push-notifications|Got notification | ChatMessageReceived",
      "{",
      '  "type": "new_message",',
      '  "eventId": "6919591299b7de4d6f0d651e",',
      '  "dialogId": "dialog-placeholder",',
      '  "message": {',
      '    "_id": "6919591201663a302e04ee6e",',
      '    "uid": "dialog-placeholder",',
      '    "type": 10,',
      '    "dt": 1763268882,',
      '    "text": "",',
      '    "templateId": "5967733e86f774602332fc84 description",',
      '    "hasRewards": false,',
      '    "maxStorageTime": 604800',
      "  }",
      "}",
    ].join("\n");

    const events = extractNotificationEvents(text);

    expect(events).toEqual([
      { kind: "task", taskId: "5967733e86f774602332fc84", status: "accepted", occurredAt: new Date(1763268882 * 1000) },
    ]);
  });

  it("extracts a real quest-completed event (message.type 12) with a multi-line rewards payload", () => {
    const text = [
      "2025-12-24 12:37:13.762|1.0.0.1.41967|Info|push-notifications|Got notification | ChatMessageReceived",
      "{",
      '  "type": "new_message",',
      '  "eventId": "691946e9bfc205db5c0eabb1",',
      '  "dialogId": "dialog-placeholder",',
      '  "message": {',
      '    "_id": "691946e9379bde1a8f0df5f249",',
      '    "uid": "dialog-placeholder",',
      '    "type": 12,',
      '    "dt": 1763264233,',
      '    "text": "",',
      '    "templateId": "61604635c725987e815b1a46 successMessageText dialog-placeholder 0",',
      '    "items": {',
      '      "stash": "691946e9379bde1a8f0df5f3",',
      '      "data": [',
      "        {",
      '          "_id": "691946e9379bde1a8f0df5f1",',
      '          "_tpl": "5449016a4bdc2d6f028b456f",',
      '          "upd": { "StackObjectsCount": 4929 },',
      '          "parentId": "691946e9379bde1a8f0df5f3",',
      '          "slotId": "main"',
      "        }",
      "      ]",
      "    },",
      '    "maxStorageTime": 172800,',
      '    "profileChangeEvents": [],',
      '    "hasRewards": true',
      "  }",
      "}",
    ].join("\n");

    const events = extractNotificationEvents(text);

    expect(events).toEqual([
      {
        kind: "task",
        taskId: "61604635c725987e815b1a46",
        status: "completed",
        occurredAt: new Date(1763264233 * 1000),
      },
    ]);
  });

  it("extracts a real quest-failed event (message.type 11)", () => {
    const text = [
      "2026-04-16 09:15:22.637|1.0.4.1.44236|Info|push-notifications|Got notification | ChatMessageReceived",
      "{",
      '  "type": "new_message",',
      '  "eventId": "69e3f46aeefd5fefdb223696",',
      '  "dialogId": "dialog-placeholder",',
      '  "message": {',
      '    "_id": "69e3f46a5c80cb83270482a8",',
      '    "uid": "dialog-placeholder",',
      '    "type": 11,',
      '    "dt": 1776546922,',
      '    "text": "quest started",',
      '    "templateId": "596a101f86f7741ddb481582 failMessageText",',
      '    "hasRewards": false,',
      '    "maxStorageTime": 604800',
      "  }",
      "}",
    ].join("\n");

    const events = extractNotificationEvents(text);

    expect(events).toEqual([
      { kind: "task", taskId: "596a101f86f7741ddb481582", status: "failed", occurredAt: new Date(1776546922 * 1000) },
    ]);
  });

  it("extracts a real raid-ended event, ignoring the always-'Free' status field", () => {
    const text = [
      "2025-11-22 15:44:56.154|1.0.0.1.41923|Info|push-notifications|Got notification | UserMatchOver",
      "{",
      '  "type": "userMatchOver",',
      '  "eventId": "69222ed80324ce18df0f0131",',
      '  "profileid": "profile-placeholder",',
      '  "status": "Free",',
      '  "location": "TarkovStreets",',
      '  "raidMode": "Online",',
      '  "mode": "deathmatch",',
      '  "shortId": null',
      "}",
    ].join("\n");

    const events = extractNotificationEvents(text);

    expect(events).toEqual([
      { kind: "raidEnded", occurredAt: new Date(2025, 10, 22, 15, 44, 56, 154), map: "TarkovStreets" },
    ]);
  });

  it("ignores non-task notification types like ChatMessageReceived flea-market messages (message.type 4)", () => {
    const text = [
      "2024-05-27 15:32:29.637|1.0.0.1.41967|Info|push-notifications|Got notification | ChatMessageReceived",
      "{",
      '  "type": "new_message",',
      '  "eventId": "6654dfd0ba3f3da279066bc6",',
      '  "message": {',
      '    "type": 4,',
      '    "templateId": "5bdabfb886f7743e152e867e 0",',
      '    "systemData": { "buyerNickname": "placeholder", "soldItem": "56deeefcd2720bc8328b4568", "itemCount": 1 }',
      "  }",
      "}",
    ].join("\n");

    expect(extractNotificationEvents(text)).toEqual([]);
  });

  it("skips a truncated JSON block without throwing", () => {
    const text = [
      "2026-01-01 00:00:00.000|1.0.0.0.1|Info|push-notifications|Got notification | ChatMessageReceived",
      "{",
      '  "type": "new_message"',
      // no closing brace — file ends mid-write, as happens when read while the game is still writing it
    ].join("\n");

    expect(() => extractNotificationEvents(text)).not.toThrow();
    expect(extractNotificationEvents(text)).toEqual([]);
  });

  it("skips malformed JSON without throwing and continues parsing subsequent lines", () => {
    const text = [
      "2026-01-01 00:00:00.000|1.0.0.0.1|Info|push-notifications|Got notification | ChatMessageReceived",
      "{ this is not valid json",
      "}",
      "2026-01-01 00:00:01.000|1.0.0.0.1|Info|push-notifications|Got notification | ChatMessageReceived",
      "{",
      '  "type": "new_message",',
      '  "message": { "type": 10, "dt": 1700000000, "templateId": "aaaaaaaaaaaaaaaaaaaaaaaa description" }',
      "}",
    ].join("\n");

    expect(extractNotificationEvents(text)).toEqual([
      {
        kind: "task",
        taskId: "aaaaaaaaaaaaaaaaaaaaaaaa",
        status: "accepted",
        occurredAt: new Date(1700000000 * 1000),
      },
    ]);
  });

  it("returns an empty array for text with no notification lines", () => {
    expect(extractNotificationEvents("just some unrelated log content\nnothing to see here")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/logWatcher/notificationEvents.test.ts`
Expected: FAIL — `Cannot find module './notificationEvents.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/logWatcher/notificationEvents.ts`:

```ts
import { parseLogLine, logLineTimestamp, type ParsedLogLine } from "./logLine.js";

export type NotificationEvent =
  | { kind: "task"; taskId: string; status: "accepted" | "failed" | "completed"; occurredAt: Date }
  | { kind: "raidEnded"; occurredAt: Date; map: string | null };

const TASK_STATUS_BY_TYPE: Record<number, "accepted" | "failed" | "completed"> = {
  10: "accepted",
  11: "failed",
  12: "completed",
};

export function extractNotificationEvents(fileText: string): NotificationEvent[] {
  const lines = fileText.split(/\r?\n/);
  const events: NotificationEvent[] = [];

  for (let i = 0; i < lines.length; i++) {
    const parsed = parseLogLine(lines[i]);
    if (!parsed) {
      continue;
    }

    if (parsed.message.includes("Got notification | ChatMessageReceived")) {
      const { json, nextIndex } = readJsonBlock(lines, i + 1);
      i = nextIndex;
      if (json) {
        const event = parseTaskEvent(json, parsed);
        if (event) {
          events.push(event);
        }
      }
      continue;
    }

    if (parsed.message.includes("Got notification | UserMatchOver")) {
      const { json, nextIndex } = readJsonBlock(lines, i + 1);
      i = nextIndex;
      if (json) {
        events.push({
          kind: "raidEnded",
          occurredAt: logLineTimestamp(parsed),
          map: typeof json.location === "string" ? json.location : null,
        });
      }
      continue;
    }
  }

  return events;
}

function readJsonBlock(lines: string[], startIndex: number): { json: any; nextIndex: number } {
  if (lines[startIndex]?.trim() !== "{") {
    return { json: null, nextIndex: startIndex - 1 };
  }

  let endIndex = -1;
  for (let i = startIndex; i < lines.length; i++) {
    if (lines[i].trim() === "}") {
      endIndex = i;
      break;
    }
  }
  if (endIndex === -1) {
    return { json: null, nextIndex: lines.length - 1 };
  }

  const blockText = lines.slice(startIndex, endIndex + 1).join("\n");
  try {
    return { json: JSON.parse(blockText), nextIndex: endIndex };
  } catch {
    return { json: null, nextIndex: endIndex };
  }
}

function parseTaskEvent(json: any, headerLine: ParsedLogLine): NotificationEvent | null {
  const message = json?.message;
  if (!message || typeof message.type !== "number") {
    return null;
  }
  const status = TASK_STATUS_BY_TYPE[message.type];
  if (!status) {
    return null;
  }
  const templateId = typeof message.templateId === "string" ? message.templateId : "";
  const taskId = templateId.split(" ")[0];
  if (!taskId) {
    return null;
  }
  const occurredAt = typeof message.dt === "number" ? new Date(message.dt * 1000) : logLineTimestamp(headerLine);
  return { kind: "task", taskId, status, occurredAt };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/logWatcher/notificationEvents.test.ts`
Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/logWatcher/notificationEvents.ts src/logWatcher/notificationEvents.test.ts
git commit -m "Add quest/raid-end event extraction from real notification payloads

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Raid-start event extraction from the application log

**Files:**
- Create: `src/logWatcher/raidStartEvents.ts`
- Test: `src/logWatcher/raidStartEvents.test.ts`

**Interfaces:**
- Consumes: `parseLogLine`, `logLineTimestamp` from `src/logWatcher/logLine.ts` (Task 2).
- Produces:
  - `RaidStartEvent` interface `{ occurredAt: Date; map: string | null; raidId: string | null; mode: string | null }`.
  - `extractRaidStartEvents(fileText: string): RaidStartEvent[]` from `src/logWatcher/raidStartEvents.ts`.

**Design note:** the fixture below reproduces the real line sequence
from an actual multi-raid play session on this machine (`scene preset
path:` → `LocationLoaded:` → `MatchingCompleted:` →
`TRACE-NetworkGameCreate profileStatus:` → `GameStarting:` →
`GameStarted:`), with only the profile ID and session ID inside the
`profileStatus` line replaced by placeholders. A raid is only emitted
once both the `profileStatus` line (which carries map/raidId/mode) and a
following `GameStarted:` line have been seen — this matches the real
data, where a raid that's still loading (matched but not yet started)
has a `profileStatus` line with no `GameStarted:` yet.

- [ ] **Step 1: Write the failing test**

Create `src/logWatcher/raidStartEvents.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractRaidStartEvents } from "./raidStartEvents.js";

const PROFILE_STATUS_LINE =
  "2026-05-31 19:14:50.104|1.0.5.0.45272|Debug|application|TRACE-NetworkGameCreate profileStatus: 'Profileid: placeholder-profile-id, Status: Busy, RaidMode: Online, Ip: 172.98.82.131, Port: 17006, Location: TarkovStreets, Sid: placeholder-session-id, GameMode: deathmatch, shortId: FW3C55'";

describe("extractRaidStartEvents", () => {
  it("extracts a real raid-start sequence: profileStatus followed by GameStarted", () => {
    const text = [
      "2026-05-31 19:13:02.048|1.0.5.0.45272|Info|application|scene preset path:maps/city_preset.bundle rcid:city.scenespreset.asset",
      "2026-05-31 19:13:38.712|1.0.5.0.45272|Info|application|MatchingCompleted:21.66 real:38.2 diff:16.54",
      "2026-05-31 19:14:49.666|1.0.5.0.45272|Info|application|LocationLoaded:85.56 real:109.16 diff:23.6",
      PROFILE_STATUS_LINE,
      "2026-05-31 19:14:50.139|1.0.5.0.45272|Debug|application|TRACE-NetworkGameCreate 4",
      "2026-05-31 19:15:31.816|1.0.5.0.45272|Info|application|GameStarting:118.86(2.19) real:151.31(9.83) diff:32.44",
      "2026-05-31 19:15:31.816|1.0.5.0.45272|Info|application|GameStarted:118.86(2.19) real:151.31(9.83) diff:32.44",
    ].join("\n");

    const events = extractRaidStartEvents(text);

    expect(events).toEqual([
      {
        occurredAt: new Date(2026, 4, 31, 19, 15, 31, 816),
        map: "TarkovStreets",
        raidId: "FW3C55",
        mode: "Online",
      },
    ]);
  });

  it("extracts multiple raids from one session file, matching real multi-raid sessions", () => {
    const secondProfileStatusLine =
      "2026-05-31 16:54:20.000|1.0.5.0.45272|Debug|application|TRACE-NetworkGameCreate profileStatus: 'Profileid: placeholder, Status: Busy, RaidMode: Online, Ip: 1.2.3.4, Port: 1, Location: Shoreline, Sid: s2, GameMode: deathmatch, shortId: ABC123'";

    const text = [
      PROFILE_STATUS_LINE,
      "2026-05-31 19:15:31.816|1.0.5.0.45272|Info|application|GameStarted:1(0) real:1(0) diff:0",
      secondProfileStatusLine,
      "2026-05-31 16:54:27.029|1.0.5.0.45272|Info|application|GameStarted:1(0) real:1(0) diff:0",
    ].join("\n");

    const events = extractRaidStartEvents(text);

    expect(events).toHaveLength(2);
    expect(events[0].map).toBe("TarkovStreets");
    expect(events[1].map).toBe("Shoreline");
  });

  it("does not emit a raid for a profileStatus line with no following GameStarted (still loading)", () => {
    const text = [PROFILE_STATUS_LINE, "2026-05-31 19:14:50.139|1.0.5.0.45272|Debug|application|TRACE-NetworkGameCreate 4"].join(
      "\n"
    );

    expect(extractRaidStartEvents(text)).toEqual([]);
  });

  it("returns an empty array for text with no raid lines", () => {
    expect(extractRaidStartEvents("nothing relevant here")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/logWatcher/raidStartEvents.test.ts`
Expected: FAIL — `Cannot find module './raidStartEvents.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/logWatcher/raidStartEvents.ts`:

```ts
import { parseLogLine, logLineTimestamp } from "./logLine.js";

export interface RaidStartEvent {
  occurredAt: Date;
  map: string | null;
  raidId: string | null;
  mode: string | null;
}

const PROFILE_STATUS_PATTERN = /Location:\s*([^,]+).*?shortId:\s*([A-Za-z0-9]+)/;
const RAID_MODE_PATTERN = /RaidMode:\s*([^,]+)/;

export function extractRaidStartEvents(fileText: string): RaidStartEvent[] {
  const lines = fileText.split(/\r?\n/);
  const events: RaidStartEvent[] = [];
  let pending: { map: string | null; raidId: string | null; mode: string | null } | null = null;

  for (const rawLine of lines) {
    const parsed = parseLogLine(rawLine);
    if (!parsed) {
      continue;
    }

    if (parsed.message.includes("TRACE-NetworkGameCreate profileStatus:")) {
      const locationMatch = PROFILE_STATUS_PATTERN.exec(parsed.message);
      const modeMatch = RAID_MODE_PATTERN.exec(parsed.message);
      pending = {
        map: locationMatch ? locationMatch[1].trim() : null,
        raidId: locationMatch ? locationMatch[2].trim() : null,
        mode: modeMatch ? modeMatch[1].trim() : null,
      };
      continue;
    }

    if (parsed.message.includes("GameStarted:") && pending) {
      events.push({ ...pending, occurredAt: logLineTimestamp(parsed) });
      pending = null;
    }
  }

  return events;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/logWatcher/raidStartEvents.test.ts`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/logWatcher/raidStartEvents.ts src/logWatcher/raidStartEvents.test.ts
git commit -m "Add raid-start event extraction, verified against a real multi-raid session

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Apply a session's events to the progress store

**Files:**
- Modify: `src/progress/store.ts` (add a small key-value metadata table)
- Modify: `src/progress/store.test.ts` (add tests for the new methods)
- Create: `src/logWatcher/applySession.ts`
- Test: `src/logWatcher/applySession.test.ts`

**Interfaces:**
- Consumes:
  - `findLogFile`, `LogFileKind` from `src/logWatcher/discovery.ts` (Task 1).
  - `extractNotificationEvents`, `NotificationEvent` from `src/logWatcher/notificationEvents.ts` (Task 3).
  - `extractRaidStartEvents`, `RaidStartEvent` from `src/logWatcher/raidStartEvents.ts` (Task 4).
  - `ProgressStore`, `TaskStatus` from `src/progress/store.ts` (Plan 1, extended by this task).
- Produces:
  - Two new `ProgressStore` methods: `setMeta(key: string, value: string): void` and `getMeta(key: string): string | null`.
  - `ApplySessionResult` interface `{ taskEventsApplied: number; raidEventsSeen: number }`.
  - `applySessionToStore(sessionDir: string, store: ProgressStore): ApplySessionResult` from `src/logWatcher/applySession.ts`. This is the shared core Task 6 (backfill) and Task 7 (live tail) both call.

**Design note:** `applySessionToStore` calls `store.recordEvent` for
every task event found — including ones already applied on a previous
call. This is safe and intentional: Plan 1's `recordEvent` upsert already
ignores an event whose timestamp isn't newer than what's stored, so
re-applying the same session's events multiple times (as the live-tail
watcher in Task 7 will do) is a no-op, not a bug. The same pattern is
used for `lastRaidSeenAt`: only overwritten if the new timestamp is
actually later than what's stored.

- [ ] **Step 1: Write the failing test**

First, add tests for the new `ProgressStore` methods. Modify
`src/progress/store.test.ts` by adding this `describe` block at the end
of the file (after the existing `describe("ProgressStore", ...)` block,
still inside no wrapping needed — just append at the top level):

```ts
describe("ProgressStore metadata", () => {
  it("returns null for a key that has never been set", () => {
    store = new ProgressStore(":memory:");
    expect(store.getMeta("lastRaidSeenAt")).toBeNull();
  });

  it("sets and retrieves a metadata value", () => {
    store = new ProgressStore(":memory:");
    store.setMeta("lastRaidSeenAt", "2026-09-16T13:20:11.174Z");
    expect(store.getMeta("lastRaidSeenAt")).toBe("2026-09-16T13:20:11.174Z");
  });

  it("overwrites an existing metadata value", () => {
    store = new ProgressStore(":memory:");
    store.setMeta("lastRaidSeenAt", "2026-09-16T13:20:11.174Z");
    store.setMeta("lastRaidSeenAt", "2026-09-17T09:00:00.000Z");
    expect(store.getMeta("lastRaidSeenAt")).toBe("2026-09-17T09:00:00.000Z");
  });
});
```

Now create `src/logWatcher/applySession.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySessionToStore } from "./applySession.js";
import { ProgressStore } from "../progress/store.js";

let tempDir: string | undefined;
let store: ProgressStore | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
  store?.close();
  store = undefined;
});

function writeSession(sessionDir: string, notificationsText: string, applicationText: string): void {
  mkdirSync(sessionDir, { recursive: true });
  const prefix = "2026.09.16_13-19-26_1.1.5.0.47426";
  writeFileSync(join(sessionDir, `${prefix} push-notifications_000.log`), notificationsText);
  writeFileSync(join(sessionDir, `${prefix} application_000.log`), applicationText);
}

describe("applySessionToStore", () => {
  it("applies a task event from the notifications log to the progress store", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-apply-session-test-"));
    const sessionDir = join(tempDir, "log_2026.09.16_13-19-26_1.1.5.0.47426");
    const notifications = [
      "2026-09-16 13:20:00.000|1.1.5.0.47426|Info|push-notifications|Got notification | ChatMessageReceived",
      "{",
      '  "message": { "type": 10, "dt": 1700000000, "templateId": "aaaaaaaaaaaaaaaaaaaaaaaa description" }',
      "}",
    ].join("\n");
    writeSession(sessionDir, notifications, "");
    store = new ProgressStore(":memory:");

    const result = applySessionToStore(sessionDir, store);

    expect(result.taskEventsApplied).toBe(1);
    expect(store.getStatus("aaaaaaaaaaaaaaaaaaaaaaaa")).toBe("accepted");
  });

  it("records lastRaidSeenAt from a raid-start event in the application log", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-apply-session-test-"));
    const sessionDir = join(tempDir, "log_2026.09.16_13-19-26_1.1.5.0.47426");
    const application = [
      "2026-05-31 19:14:50.104|1.0.5.0.45272|Debug|application|TRACE-NetworkGameCreate profileStatus: 'Location: TarkovStreets, RaidMode: Online, shortId: FW3C55'",
      "2026-05-31 19:15:31.816|1.0.5.0.45272|Info|application|GameStarted:1(0) real:1(0) diff:0",
    ].join("\n");
    writeSession(sessionDir, "", application);
    store = new ProgressStore(":memory:");

    const result = applySessionToStore(sessionDir, store);

    expect(result.raidEventsSeen).toBe(1);
    expect(store.getMeta("lastRaidSeenAt")).toBe(new Date(2026, 4, 31, 19, 15, 31, 816).toISOString());
  });

  it("does not overwrite lastRaidSeenAt with an older timestamp", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-apply-session-test-"));
    const sessionDir = join(tempDir, "log_2026.09.16_13-19-26_1.1.5.0.47426");
    writeSession(sessionDir, "", "");
    store = new ProgressStore(":memory:");
    store.setMeta("lastRaidSeenAt", new Date(2027, 0, 1).toISOString());

    applySessionToStore(sessionDir, store);

    expect(store.getMeta("lastRaidSeenAt")).toBe(new Date(2027, 0, 1).toISOString());
  });

  it("handles a session directory with no matching log files without throwing", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-apply-session-test-"));
    const sessionDir = join(tempDir, "empty-session");
    mkdirSync(sessionDir);
    store = new ProgressStore(":memory:");

    const result = applySessionToStore(sessionDir, store);

    expect(result).toEqual({ taskEventsApplied: 0, raidEventsSeen: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/progress/store.test.ts src/logWatcher/applySession.test.ts`
Expected: FAIL — the metadata tests fail with "store.setMeta is not a function"; the `applySession.test.ts` tests fail with `Cannot find module './applySession.js'`.

- [ ] **Step 3: Write the minimal implementation**

Modify `src/progress/store.ts`. In the constructor, add a second table
after the existing `task_progress` one, and add the two new methods.
Full new content for the file:

```ts
import Database from "better-sqlite3";

export type TaskStatus = "accepted" | "completed" | "failed";

interface ProgressRow {
  task_id: string;
  status: TaskStatus;
}

interface MetaRow {
  value: string;
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

  close(): void {
    this.db.close();
  }
}
```

Create `src/logWatcher/applySession.ts`:

```ts
import { readFileSync } from "node:fs";
import { findLogFile } from "./discovery.js";
import { extractNotificationEvents } from "./notificationEvents.js";
import { extractRaidStartEvents } from "./raidStartEvents.js";
import type { ProgressStore } from "../progress/store.js";

export interface ApplySessionResult {
  taskEventsApplied: number;
  raidEventsSeen: number;
}

const LAST_RAID_SEEN_KEY = "lastRaidSeenAt";

export function applySessionToStore(sessionDir: string, store: ProgressStore): ApplySessionResult {
  let taskEventsApplied = 0;
  let raidEventsSeen = 0;
  let latestRaidTimestamp: Date | null = null;

  const notificationsPath = findLogFile(sessionDir, "pushNotifications");
  if (notificationsPath) {
    const text = readFileSync(notificationsPath, "utf-8");
    for (const event of extractNotificationEvents(text)) {
      if (event.kind === "task") {
        store.recordEvent(event.taskId, event.status, event.occurredAt);
        taskEventsApplied++;
      } else {
        raidEventsSeen++;
        if (!latestRaidTimestamp || event.occurredAt > latestRaidTimestamp) {
          latestRaidTimestamp = event.occurredAt;
        }
      }
    }
  }

  const applicationPath = findLogFile(sessionDir, "application");
  if (applicationPath) {
    const text = readFileSync(applicationPath, "utf-8");
    for (const event of extractRaidStartEvents(text)) {
      raidEventsSeen++;
      if (!latestRaidTimestamp || event.occurredAt > latestRaidTimestamp) {
        latestRaidTimestamp = event.occurredAt;
      }
    }
  }

  if (latestRaidTimestamp) {
    const previous = store.getMeta(LAST_RAID_SEEN_KEY);
    if (!previous || new Date(previous) < latestRaidTimestamp) {
      store.setMeta(LAST_RAID_SEEN_KEY, latestRaidTimestamp.toISOString());
    }
  }

  return { taskEventsApplied, raidEventsSeen };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/progress/store.test.ts src/logWatcher/applySession.test.ts`
Expected: PASS — 8 tests in `store.test.ts` (5 existing + 3 new), 4 tests in `applySession.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/progress/store.ts src/progress/store.test.ts src/logWatcher/applySession.ts src/logWatcher/applySession.test.ts
git commit -m "Add session-to-store application, extending ProgressStore with metadata

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Backfill runner

**Files:**
- Create: `src/logWatcher/backfill.ts`
- Test: `src/logWatcher/backfill.test.ts`

**Interfaces:**
- Consumes: `listSessionFolders` from `src/logWatcher/discovery.ts` (Task 1); `applySessionToStore` from `src/logWatcher/applySession.ts` (Task 5); `ProgressStore` from `src/progress/store.ts`.
- Produces: `BackfillResult` interface `{ sessionsProcessed: number; taskEventsApplied: number; raidEventsSeen: number }` and `runBackfill(logsRootDir: string, store: ProgressStore): BackfillResult` from `src/logWatcher/backfill.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/logWatcher/backfill.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBackfill } from "./backfill.js";
import { ProgressStore } from "../progress/store.js";

let tempDir: string | undefined;
let store: ProgressStore | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
  store?.close();
  store = undefined;
});

function writeSession(logsRoot: string, folderName: string, taskId: string, dt: number): void {
  const sessionDir = join(logsRoot, folderName);
  mkdirSync(sessionDir, { recursive: true });
  const notifications = [
    "2026-09-16 13:20:00.000|1.1.5.0.47426|Info|push-notifications|Got notification | ChatMessageReceived",
    "{",
    `  "message": { "type": 10, "dt": ${dt}, "templateId": "${taskId} description" }`,
    "}",
  ].join("\n");
  writeFileSync(join(sessionDir, "prefix push-notifications_000.log"), notifications);
}

describe("runBackfill", () => {
  it("processes every session folder and applies their task events", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-backfill-test-"));
    writeSession(tempDir, "log_2025.01.01_10-00-00_1.0.0.0.1", "aaaaaaaaaaaaaaaaaaaaaaaa", 1700000000);
    writeSession(tempDir, "log_2026.01.01_10-00-00_1.0.0.0.2", "bbbbbbbbbbbbbbbbbbbbbbbb", 1750000000);
    store = new ProgressStore(":memory:");

    const result = runBackfill(tempDir, store);

    expect(result.sessionsProcessed).toBe(2);
    expect(result.taskEventsApplied).toBe(2);
    expect(store.getStatus("aaaaaaaaaaaaaaaaaaaaaaaa")).toBe("accepted");
    expect(store.getStatus("bbbbbbbbbbbbbbbbbbbbbbbb")).toBe("accepted");
  });

  it("returns zero counts for a logs directory with no sessions", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-backfill-test-"));
    store = new ProgressStore(":memory:");

    const result = runBackfill(tempDir, store);

    expect(result).toEqual({ sessionsProcessed: 0, taskEventsApplied: 0, raidEventsSeen: 0 });
  });

  it("does not throw when the logs directory does not exist", () => {
    store = new ProgressStore(":memory:");
    expect(() => runBackfill(join(tmpdir(), "does-not-exist-" + Date.now()), store!)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/logWatcher/backfill.test.ts`
Expected: FAIL — `Cannot find module './backfill.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/logWatcher/backfill.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/logWatcher/backfill.test.ts`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/logWatcher/backfill.ts src/logWatcher/backfill.test.ts
git commit -m "Add backfill runner over all historical log sessions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Live-tail watcher

**Files:**
- Create: `src/logWatcher/liveTail.ts`
- Test: `src/logWatcher/liveTail.test.ts`

**Interfaces:**
- Consumes: `findLatestSession` from `src/logWatcher/discovery.ts` (Task 1); `applySessionToStore` from `src/logWatcher/applySession.ts` (Task 5); `ProgressStore` from `src/progress/store.ts` (this task also reads back the `lastWatcherPollAt` meta key it writes, via `store.getMeta`).
- Produces: `LogTailerOptions` interface `{ pollIntervalMs?: number }` and `LogTailer` class from `src/logWatcher/liveTail.ts` with `constructor(logsRootDir: string, store: ProgressStore, options?: LogTailerOptions)`, `start(): void`, `stop(): void`, and a public `poll(): void`. Every successful `poll()` (one that finds a session) also stamps `store.setMeta("lastWatcherPollAt", <ISO timestamp>)` — this is the data Plan 3's "last event seen at &lt;time&gt;" staleness indicator (spec, Error handling) reads from; without it nothing in this plan records when the watcher last actually ran.

**Design note — why full re-read on every poll, not byte-offset
tailing:** real session log files on this machine top out in the tens of
KB for the files this plan watches (push-notifications and application;
the much larger `output.log`, up to ~570KB observed, is deliberately not
watched — see Task 1's `LogFileKind`). At that size, and on a multi-
second poll interval (the game's own logs aren't updated live during a
raid anyway, per the design spec's research), re-reading the whole file
and re-running the same pure extractors from Tasks 3-4 every tick is
simpler and more robust than incremental byte-offset tailing with
partial-line buffering — and it composes for free with `recordEvent`'s
idempotent upsert (Task 5's design note): re-deriving an event that was
already applied is a harmless no-op, not a bug to guard against.
`poll()` is exposed as a public method specifically so tests can call it
directly instead of manipulating real timers.

- [ ] **Step 1: Write the failing test**

Create `src/logWatcher/liveTail.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LogTailer } from "./liveTail.js";
import { ProgressStore } from "../progress/store.js";

let tempDir: string | undefined;
let store: ProgressStore | undefined;
let tailer: LogTailer | undefined;

afterEach(() => {
  tailer?.stop();
  tailer = undefined;
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
  store?.close();
  store = undefined;
  vi.useRealTimers();
});

function writeSessionWithTask(logsRoot: string, folderName: string, taskId: string): string {
  const sessionDir = join(logsRoot, folderName);
  mkdirSync(sessionDir, { recursive: true });
  const notifications = [
    "2026-09-16 13:20:00.000|1.1.5.0.47426|Info|push-notifications|Got notification | ChatMessageReceived",
    "{",
    `  "message": { "type": 10, "dt": 1700000000, "templateId": "${taskId} description" }`,
    "}",
  ].join("\n");
  const notificationsPath = join(sessionDir, "prefix push-notifications_000.log");
  writeFileSync(notificationsPath, notifications);
  return notificationsPath;
}

describe("LogTailer.poll", () => {
  it("applies the latest session's events to the store", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-livetail-test-"));
    writeSessionWithTask(tempDir, "log_2026.09.16_13-19-26_1.1.5.0.47426", "aaaaaaaaaaaaaaaaaaaaaaaa");
    store = new ProgressStore(":memory:");
    tailer = new LogTailer(tempDir, store);

    tailer.poll();

    expect(store.getStatus("aaaaaaaaaaaaaaaaaaaaaaaa")).toBe("accepted");
  });

  it("picks up new content appended to the file between polls", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-livetail-test-"));
    const notificationsPath = writeSessionWithTask(
      tempDir,
      "log_2026.09.16_13-19-26_1.1.5.0.47426",
      "aaaaaaaaaaaaaaaaaaaaaaaa"
    );
    store = new ProgressStore(":memory:");
    tailer = new LogTailer(tempDir, store);
    tailer.poll();
    expect(store.getStatus("bbbbbbbbbbbbbbbbbbbbbbbb")).toBeNull();

    const moreContent = [
      "",
      "2026-09-16 13:21:00.000|1.1.5.0.47426|Info|push-notifications|Got notification | ChatMessageReceived",
      "{",
      '  "message": { "type": 10, "dt": 1700000100, "templateId": "bbbbbbbbbbbbbbbbbbbbbbbb description" }',
      "}",
    ].join("\n");
    writeFileSync(notificationsPath, require("node:fs").readFileSync(notificationsPath, "utf-8") + moreContent);
    tailer.poll();

    expect(store.getStatus("bbbbbbbbbbbbbbbbbbbbbbbb")).toBe("accepted");
  });

  it("does nothing when there is no session yet, without throwing", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-livetail-test-"));
    store = new ProgressStore(":memory:");
    tailer = new LogTailer(tempDir, store);

    expect(() => tailer!.poll()).not.toThrow();
    expect(store.getMeta("lastWatcherPollAt")).toBeNull();
  });

  it("stamps lastWatcherPollAt on every successful poll", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-livetail-test-"));
    writeSessionWithTask(tempDir, "log_2026.09.16_13-19-26_1.1.5.0.47426", "aaaaaaaaaaaaaaaaaaaaaaaa");
    store = new ProgressStore(":memory:");
    tailer = new LogTailer(tempDir, store);

    tailer.poll();

    const stamped = store.getMeta("lastWatcherPollAt");
    expect(stamped).not.toBeNull();
    expect(Number.isNaN(new Date(stamped!).getTime())).toBe(false);
  });
});

describe("LogTailer.start / stop", () => {
  it("polls repeatedly on the configured interval until stopped", () => {
    vi.useFakeTimers();
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-livetail-test-"));
    writeSessionWithTask(tempDir, "log_2026.09.16_13-19-26_1.1.5.0.47426", "aaaaaaaaaaaaaaaaaaaaaaaa");
    store = new ProgressStore(":memory:");
    tailer = new LogTailer(tempDir, store, { pollIntervalMs: 1000 });
    const pollSpy = vi.spyOn(tailer, "poll");

    tailer.start();
    expect(pollSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3500);
    expect(pollSpy).toHaveBeenCalledTimes(4);

    tailer.stop();
    vi.advanceTimersByTime(5000);
    expect(pollSpy).toHaveBeenCalledTimes(4);
  });
});
```

Note: the second test uses `require("node:fs")` inline deliberately to
keep the append-content step visually next to where it's used in this
test file, since the file already imports `writeFileSync` at the top
for setup — an implementer following this brief exactly should keep
both; do not "clean up" by removing the top-level import.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/logWatcher/liveTail.test.ts`
Expected: FAIL — `Cannot find module './liveTail.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/logWatcher/liveTail.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/logWatcher/liveTail.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — all tests across the whole project green (Plan 1's 29
plus this plan's new tests: 9 discovery + 7 logLine + 9 notificationEvents
+ 4 raidStartEvents + 3 new store metadata + 4 applySession + 3 backfill
+ 6 liveTail = 45 new tests, 74 total — the exact count doesn't matter,
zero failures does).

- [ ] **Step 6: Commit**

```bash
git add src/logWatcher/liveTail.ts src/logWatcher/liveTail.test.ts
git commit -m "Add live-tail watcher polling the current session

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## What this plan does not cover (by design)

- **Wiring the watcher into a running application** (starting `runBackfill`
  once then `LogTailer.start()` on app launch, choosing the real
  `logsRootDir` on the user's machine, a system-tray shell) — that's
  Plan 3's job, alongside the dashboard.
- **Level-ups.** The design spec's component list mentions them, but no
  verified real log signal for player level was found or confirmed during
  this plan's research, and it isn't load-bearing for the storyline-
  tracking goal. Deferred rather than built on a guess.
- **Raid outcome (survived/died/MIA).** Confirmed above that the only
  candidate signal (`UserMatchOver.status`) is always `"Free"` regardless
  of outcome. This plan tracks raid start/end timing and map only.
- **Auto-detecting the EFT install path** (TarkovMonitor's registry/Steam-
  manifest lookup chain). This plan's functions all take `logsRootDir` as
  an explicit parameter — Plan 3 can add a "let the user point at their
  Logs folder, remember it" setting, which is simpler and less fragile
  than replicating TarkovMonitor's auto-detection (which has its own open
  GitHub issues about failing on some installs).
