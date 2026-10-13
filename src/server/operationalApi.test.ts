import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildOperationalResponse } from "./operationalApi.js";
import type { OperationalDeps } from "./operationalApi.js";
import { ProgressStore } from "../progress/store.js";
import { sampleTasks } from "../tarkovData/__fixtures__/sampleTasks.js";

const NOW = new Date(2026, 9, 12, 15, 0, 0); // Oct 12, 3pm local
const sec = (d: Date) => Math.floor(d.getTime() / 1000);
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

// [task id, message type (10 accepted, 11 failed, 12 completed), when, trader id]
type Event = [string, number, Date, string?];
const OPERATIONAL = "616041eb031af660100c9967"; // not in the quest list
const OTHER_OP = "616051e63f96cc089c1cf37f";

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

function setUp(events: Event[]): OperationalDeps {
  tempDir = mkdtempSync(join(tmpdir(), "tarkov-op-test-"));
  const dir = join(tempDir, "log_2026.10.12_9-00-00_1.2.0.0.1");
  mkdirSync(dir, { recursive: true });
  const lines = events.flatMap(([id, type, at, trader]) => [
    "2026-10-12 09:00:00.000|1.2.0.0.1|Info|push-notifications|Got notification | ChatMessageReceived",
    "{",
    `  "message": { "type": ${type}, "dt": ${sec(at)}, ${trader ? `"uid": "${trader}", ` : ""}"templateId": "${id} successMessageText" }`,
    "}",
  ]);
  writeFileSync(join(dir, "2026.10.12_9-00-00_1.2.0.0.1 push-notifications_000.log"), lines.join("\n"));
  store = new ProgressStore(":memory:");
  return { store, logsRootDir: tempDir, getTasks: () => sampleTasks, now: () => NOW };
}

const TRADER = sampleTasks[0].trader; // { id, name }

describe("buildOperationalResponse", () => {
  it("counts completed operational tasks today, in the last week, and since the reset, newest first", () => {
    const deps = setUp([
      [OPERATIONAL, 12, hoursAgo(1), TRADER.id], // today
      [OTHER_OP, 12, hoursAgo(2), TRADER.id], // today
      [OPERATIONAL, 12, hoursAgo(30), TRADER.id], // yesterday
      [OPERATIONAL, 12, hoursAgo(24 * 10), TRADER.id], // too old for "last week"
    ]);

    const response = buildOperationalResponse(deps);

    expect(response.completed).toEqual({ today: 2, lastWeek: 3, sinceReset: 4 });
    expect(response.recent.map((e) => e.at)).toEqual([hoursAgo(1), hoursAgo(2), hoursAgo(30), hoursAgo(24 * 10)].map((d) => d.toISOString()));
    expect(response.recent[0]).toEqual({ at: hoursAgo(1).toISOString(), trader: TRADER.name, status: "completed" });
  });

  it("leaves out quests that are in the quest list, and accepted messages", () => {
    const deps = setUp([
      [sampleTasks[0].id, 12, hoursAgo(1)],
      [OPERATIONAL, 10, hoursAgo(1)],
    ]);

    expect(buildOperationalResponse(deps)).toEqual({ completed: { today: 0, lastWeek: 0, sinceReset: 0 }, failedSinceReset: 0, recent: [] });
  });

  it("counts failures separately", () => {
    const deps = setUp([
      [OPERATIONAL, 12, hoursAgo(1)],
      [OPERATIONAL, 11, hoursAgo(2)],
    ]);

    const response = buildOperationalResponse(deps);

    expect(response.completed.sinceReset).toBe(1);
    expect(response.failedSinceReset).toBe(1);
    expect(response.recent.map((e) => e.status)).toEqual(["completed", "failed"]);
  });

  it("ignores everything from before the last reset", () => {
    const deps = setUp([
      [OPERATIONAL, 12, hoursAgo(48)],
      [OPERATIONAL, 12, hoursAgo(1)],
    ]);
    deps.store.resetProgress(hoursAgo(10));

    expect(buildOperationalResponse(deps).completed).toEqual({ today: 1, lastWeek: 1, sinceReset: 1 });
  });

  it("shows no trader when it isn't one the quest data knows", () => {
    const deps = setUp([[OPERATIONAL, 12, hoursAgo(1)]]);

    expect(buildOperationalResponse(deps).recent[0].trader).toBeNull();
  });

  it("limits the list to the most recent dozen", () => {
    const deps = setUp(Array.from({ length: 20 }, (_, i): Event => [OPERATIONAL, 12, hoursAgo(i + 1)]));

    const response = buildOperationalResponse(deps);

    expect(response.recent).toHaveLength(12);
    expect(response.completed.sinceReset).toBe(20);
  });

  it("copes with no log folder", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-op-test-"));
    store = new ProgressStore(":memory:");

    expect(buildOperationalResponse({ store, logsRootDir: join(tempDir, "missing"), getTasks: () => sampleTasks, now: () => NOW }).recent).toEqual([]);
  });
});
