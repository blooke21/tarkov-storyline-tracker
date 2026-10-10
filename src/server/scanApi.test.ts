import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanLogs } from "./scanApi.js";
import type { ScanDeps } from "./scanApi.js";
import { ProgressStore } from "../progress/store.js";
import type { TarkovTask } from "../tarkovData/types.js";

const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const UNLISTED = "cccccccccccccccccccccccc";

function makeTask(id: string, name: string, requires: string[] = []): TarkovTask {
  return {
    id,
    name,
    trader: { id: "t", name: "Prapor" },
    map: null,
    wikiLink: null,
    kappaRequired: false,
    lightkeeperRequired: false,
    factionName: "Any",
    minPlayerLevel: null,
    objectives: [],
    taskRequirements: requires.map((task) => ({ task: { id: task }, status: ["complete"] })),
  };
}

const tasks = [makeTask(A, "Alpha"), makeTask(B, "Bravo", [A])];

// [task id, message type (10 accepted, 12 completed), unix seconds]
type Event = [string, number, number];
const T0 = 1760000000;

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

function setUp(events: Event[]): ScanDeps {
  tempDir = mkdtempSync(join(tmpdir(), "tarkov-scan-test-"));
  const sessionDir = join(tempDir, "log_2026.09.16_13-19-26_1.1.5.0.47426");
  mkdirSync(sessionDir, { recursive: true });
  const lines = events.flatMap(([id, type, dt]) => [
    "2026-09-16 13:20:00.000|1.1.5.0.47426|Info|push-notifications|Got notification | ChatMessageReceived",
    "{",
    `  "message": { "type": ${type}, "dt": ${dt}, "templateId": "${id} description" }`,
    "}",
  ]);
  writeFileSync(join(sessionDir, "2026.09.16_13-19-26_1.1.5.0.47426 push-notifications_000.log"), lines.join("\n"));
  store = new ProgressStore(":memory:");
  return { store, logsRootDir: tempDir, getTasks: () => tasks };
}

describe("scanLogs", () => {
  it("adds quests the logs show that the tracker had missed, and reports what it found", () => {
    const deps = setUp([
      [A, 10, T0],
      [A, 12, T0 + 60],
      [B, 10, T0 + 120],
    ]);

    const report = scanLogs(deps);

    expect(deps.store.getStatus(A)).toBe("completed");
    expect(deps.store.getStatus(B)).toBe("accepted");
    expect(report).toMatchObject({
      logFolders: 1,
      foldersWithQuestLog: 1,
      eventsInLogs: 3,
      eventsCounted: 3,
      added: 2,
      changed: 0,
      tracked: { completed: 1, accepted: 1, failed: 0 },
      firstEventAt: new Date(T0 * 1000).toISOString(),
      lastEventAt: new Date((T0 + 120) * 1000).toISOString(),
    });
    expect(report.changes).toEqual([
      { name: "Alpha", from: null, to: "completed" },
      { name: "Bravo", from: null, to: "accepted" },
    ]);
  });

  it("changes nothing when the tracker already matches the logs", () => {
    const deps = setUp([[A, 12, T0]]);
    scanLogs(deps);

    const second = scanLogs(deps);

    expect(second.added).toBe(0);
    expect(second.changed).toBe(0);
    expect(second.changes).toEqual([]);
    expect(second.tracked.completed).toBe(1);
  });

  it("corrects a quest the tracker has out of date", () => {
    const deps = setUp([
      [A, 10, T0],
      [A, 12, T0 + 60],
    ]);
    deps.store.recordEvent(A, "accepted", new Date(T0 * 1000));

    const report = scanLogs(deps);

    expect(report.changed).toBe(1);
    expect(report.changes).toEqual([{ name: "Alpha", from: "accepted", to: "completed" }]);
  });

  it("keeps quests the tracker remembers that the logs no longer show, instead of deleting them", () => {
    const deps = setUp([[A, 12, T0]]);
    deps.store.recordEvent(B, "completed", new Date((T0 - 1000) * 1000)); // from a log the game has since deleted

    const report = scanLogs(deps);

    expect(deps.store.getStatus(B)).toBe("completed");
    expect(report.keptFromEarlier).toBe(1);
  });

  it("doesn't count quest events from before the last reset", () => {
    const deps = setUp([
      [A, 12, T0],
      [B, 10, T0 + 1000],
    ]);
    deps.store.resetProgress(new Date((T0 + 500) * 1000));

    const report = scanLogs(deps);

    expect(report.eventsInLogs).toBe(2);
    expect(report.eventsCounted).toBe(1);
    expect(report.progressSince).toBe(new Date((T0 + 500) * 1000).toISOString());
    expect(deps.store.getStatus(A)).toBeNull();
    expect(deps.store.getStatus(B)).toBe("accepted");
  });

  it("counts quests that aren't in the quest list, such as operational tasks", () => {
    const deps = setUp([[UNLISTED, 12, T0]]);

    const report = scanLogs(deps);

    expect(report.notInQuestList).toBe(1);
    expect(report.changes[0].name).toMatch(/not in the quest list/);
  });

  it("points out a started quest whose required earlier quest has no completion in the logs", () => {
    const deps = setUp([[B, 10, T0]]);

    const report = scanLogs(deps);

    expect(report.missingEarlierTotal).toBe(1);
    expect(report.missingEarlier).toEqual([{ name: "Alpha", neededBy: "Bravo" }]);
  });

  it("doesn't flag anything when the earlier quest is completed", () => {
    const deps = setUp([
      [A, 12, T0],
      [B, 10, T0 + 10],
    ]);

    expect(scanLogs(deps).missingEarlierTotal).toBe(0);
  });

  it("copes with no log folder at all", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-scan-test-"));
    store = new ProgressStore(":memory:");

    const report = scanLogs({ store, logsRootDir: join(tempDir, "missing"), getTasks: () => tasks });

    expect(report).toMatchObject({ logFolders: 0, eventsInLogs: 0, added: 0, firstEventAt: null, lastEventAt: null });
  });
});
