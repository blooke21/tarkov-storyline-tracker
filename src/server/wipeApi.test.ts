import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWipeOptions, buildWipePreview, performWipe, parseSince } from "./wipeApi.js";
import type { WipeApiDeps } from "./wipeApi.js";
import { HttpError } from "./createServer.js";
import { ProgressStore } from "../progress/store.js";
import { applySessionToStore } from "../logWatcher/applySession.js";
import { runBackfill } from "../logWatcher/backfill.js";
import { convertJsonFeed } from "../tarkovData/jsonClient.js";
import { jsonFeedSample } from "../tarkovData/__fixtures__/jsonFeedSample.js";

// Real quests from the captured fixture, plus an id that isn't in the quest list (an operational task).
const FIRST_IN_LINE = "657315ddab5a49b71f098853";
const CHEMICAL_3 = "597a0e5786f77426d66c0636";
const OPERATIONAL = "616041eb031af660100c9967";

// Old character: three completions. Then a long quiet gap (the reset). Then the new character starts.
const T_OLD = 1700000000;
const T_NEW = 1700100000;
const events: Array<[string, number, number]> = [
  [FIRST_IN_LINE, 12, T_OLD],
  [CHEMICAL_3, 12, T_OLD + 100],
  [OPERATIONAL, 12, T_OLD + 200],
  [FIRST_IN_LINE, 10, T_NEW],
  [CHEMICAL_3, 10, T_NEW + 10],
];

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

function setUp(opts: { applyAll?: boolean; events?: Array<[string, number, number]> } = {}): WipeApiDeps {
  tempDir = mkdtempSync(join(tmpdir(), "tarkov-wipeapi-test-"));
  const sessionDir = join(tempDir, "log_2026.09.16_13-19-26_1.1.5.0.47426");
  mkdirSync(sessionDir, { recursive: true });
  const lines = (opts.events ?? events).flatMap(([id, type, dt]) => [
    "2026-09-16 13:20:00.000|1.1.5.0.47426|Info|push-notifications|Got notification | ChatMessageReceived",
    "{",
    `  "message": { "type": ${type}, "dt": ${dt}, "templateId": "${id} description" }`,
    "}",
  ]);
  writeFileSync(join(sessionDir, "2026.09.16_13-19-26_1.1.5.0.47426 push-notifications_000.log"), lines.join("\n"));
  store = new ProgressStore(":memory:");
  if (opts.applyAll !== false) {
    applySessionToStore(sessionDir, store);
  }
  const tasks = convertJsonFeed(jsonFeedSample);
  return { store, logsRootDir: tempDir, getTasks: () => tasks };
}

describe("buildWipeOptions", () => {
  it("lists recent quest events newest first, with real quest names", () => {
    const deps = setUp();

    const options = buildWipeOptions(deps);

    expect(options.recentEvents.map((e) => [e.name, e.status])).toEqual([
      ["Chemical - Part 3", "accepted"],
      ["First in Line", "accepted"],
      ["Quest not in the quest list (e.g. an operational task)", "completed"],
      ["Chemical - Part 3", "completed"],
      ["First in Line", "completed"],
    ]);
    expect(options.recentEvents[0].at).toBe(new Date((T_NEW + 10) * 1000).toISOString());
  });

  it("suggests the first action after the quiet gap as the likely start of the new character", () => {
    const deps = setUp();

    expect(buildWipeOptions(deps).suggestedSince).toBe(new Date(T_NEW * 1000).toISOString());
  });

  it("prefers the most recent pause over a longer one further back (an old long break must not hide the real reset)", () => {
    // A (t=0) ... 1000s pause ... B ... 100s pause ... C, D. The reset is the 100s pause before C, not the 1000s one before B.
    const base = 1760000000;
    const deps = setUp({
      events: [
        [FIRST_IN_LINE, 12, base],
        [CHEMICAL_3, 12, base + 1000],
        [OPERATIONAL, 12, base + 1100],
        [FIRST_IN_LINE, 10, base + 1105],
      ],
    });

    expect(buildWipeOptions(deps).suggestedSince).toBe(new Date((base + 1100) * 1000).toISOString());
  });

  it("makes no suggestion when there's no meaningful gap", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-wipeapi-test-"));
    store = new ProgressStore(":memory:");

    const options = buildWipeOptions({ store, logsRootDir: tempDir, getTasks: () => [] });

    expect(options.suggestedSince).toBeNull();
    expect(options.recentEvents).toEqual([]);
  });

  it("limits how many recent events are returned", () => {
    const deps = setUp();

    expect(buildWipeOptions(deps, 2).recentEvents).toHaveLength(2);
  });

  it("reports what the tracker is currently counting and any earlier wipe boundary", () => {
    const deps = setUp();

    const before = buildWipeOptions(deps);
    expect(before.current).toEqual({ completed: 1, accepted: 2, failed: 0 });
    expect(before.progressSince).toBeNull();

    deps.store.resetProgress(new Date(T_NEW * 1000));
    expect(buildWipeOptions(deps).progressSince).toBe(new Date(T_NEW * 1000).toISOString());
  });
});

describe("buildWipePreview", () => {
  it("shows what would be cleared and what would be counted, without changing anything", () => {
    const deps = setUp();
    const statusesBefore = [...deps.store.getAllStatuses()];

    const preview = buildWipePreview(deps, new Date(T_NEW * 1000));

    expect(preview.willClear).toEqual({ completed: 1, accepted: 2, failed: 0 });
    expect(preview.keptEvents).toBe(2);
    expect(preview.willTrack).toEqual([
      { name: "First in Line", status: "accepted" },
      { name: "Chemical - Part 3", status: "accepted" },
    ]);
    expect([...deps.store.getAllStatuses()]).toEqual(statusesBefore);
    expect(deps.store.getProgressSince()).toBeNull();
  });

  it("tracks a quest by its latest status when it has several events after the boundary", () => {
    const deps = setUp();

    const preview = buildWipePreview(deps, new Date(T_OLD * 1000));

    expect(preview.willTrack.find((t) => t.name === "First in Line")?.status).toBe("accepted");
  });

  it("says nothing would be tracked when the boundary is after every logged event", () => {
    const deps = setUp();

    const preview = buildWipePreview(deps, new Date((T_NEW + 1000) * 1000));

    expect(preview.keptEvents).toBe(0);
    expect(preview.willTrack).toEqual([]);
  });
});

describe("performWipe", () => {
  it("clears old progress, keeps what happened since the boundary, and remembers the boundary", () => {
    const deps = setUp();

    const result = performWipe(deps, new Date(T_NEW * 1000));

    expect(result).toMatchObject({ since: new Date(T_NEW * 1000).toISOString(), picked: 2 });
    // The wipe finishes with a full scan of the logs, so the player can see what was counted.
    expect(result.scan).toMatchObject({ eventsInLogs: 5, eventsCounted: 2, tracked: { completed: 0, accepted: 2, failed: 0 } });
    expect(deps.store.getStatus(FIRST_IN_LINE)).toBe("accepted");
    expect(deps.store.getStatus(OPERATIONAL)).toBeNull();
    expect(deps.store.getProgressSince()).toEqual(new Date(T_NEW * 1000));
  });

  it("stays wiped when the logs are read again afterwards, as on the next app start", () => {
    const deps = setUp();
    performWipe(deps, new Date(T_NEW * 1000));

    // Exactly what the app does on every start: re-read all of the log history.
    runBackfill(deps.logsRootDir, deps.store);

    expect(deps.store.getStatus(OPERATIONAL)).toBeNull();
    expect(deps.store.getAllStatuses().size).toBe(2);
  });
});

describe("parseSince", () => {
  const now = new Date("2026-10-10T15:20:00.000Z");

  it("accepts an ISO timestamp", () => {
    expect(parseSince("2026-10-10T15:12:00.000Z", now)).toEqual(new Date("2026-10-10T15:12:00.000Z"));
  });

  it("rejects a missing value with a 400", () => {
    expect(() => parseSince(null, now)).toThrow(HttpError);
    try {
      parseSince(null, now);
    } catch (error) {
      expect((error as HttpError).status).toBe(400);
    }
  });

  it("rejects something that isn't a date with a 400", () => {
    expect(() => parseSince("whenever", now)).toThrow(/since/);
  });

  it("rejects a moment well in the future (that would wipe everything and hide all new activity)", () => {
    expect(() => parseSince("2026-10-10T16:20:00.000Z", now)).toThrow(/future/);
  });

  it("allows a moment a few seconds ahead, to absorb clock differences between the browser and the app", () => {
    expect(() => parseSince("2026-10-10T15:20:30.000Z", now)).not.toThrow();
  });
});
