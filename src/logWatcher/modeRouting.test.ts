import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySessionToStore } from "./applySession.js";
import { runBackfill } from "./backfill.js";
import { collectTaskEvents } from "./collectEvents.js";
import { ProgressStore } from "../progress/store.js";

const PVE_QUEST = "aaaaaaaaaaaaaaaaaaaaaaaa";
const SEASON_QUEST = "bbbbbbbbbbbbbbbbbbbbbbbb";
const LATE_PVE_QUEST = "cccccccccccccccccccccccc";

// A session in which the player played PvE, switched to PvP Season, and switched back (like the real 2026-08-05 one).
const at = (hour: number, minute: number) => new Date(2026, 7, 5, hour, minute, 0);
const unix = (d: Date) => Math.floor(d.getTime() / 1000);
const stamp = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ` +
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:00.000`;
const request = (d: Date, host: string, path: string) =>
  `${stamp(d)}|1.1.0.0.46657|Info|backend|---> Request HTTPS, id [3]: URL: https://${host}.escapefromtarkov.com${path}. `;
const notification = (when: Date, type: number, id: string) =>
  [
    `${stamp(when)}|1.1.0.0.46657|Info|push-notifications|Got notification | ChatMessageReceived`,
    "{",
    `  "message": { "type": ${type}, "dt": ${unix(when)}, "templateId": "${id} description" }`,
    "}",
  ].join("\n");

const BACKEND = [
  request(at(11, 0), "gw-pvp", "/client/game/mode"),
  request(at(11, 1), "gw-pve", "/client/game/keepalive"),
  request(at(11, 20), "gw-pvp-season", "/client/game/keepalive"),
  request(at(11, 40), "gw-pve", "/client/game/keepalive"),
].join("\n");

const PUSH = [
  notification(at(11, 10), 12, PVE_QUEST), // while PvE
  notification(at(11, 30), 12, SEASON_QUEST), // while PvP Season
  notification(at(11, 50), 10, LATE_PVE_QUEST), // back in PvE
].join("\n");

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

function setUp(options: { backend?: string | null } = {}): { root: string; session: string } {
  tempDir = mkdtempSync(join(tmpdir(), "tarkov-mode-test-"));
  const session = join(tempDir, "log_2026.08.05_11-00-00_1.1.0.0.46657");
  mkdirSync(session, { recursive: true });
  const prefix = "2026.08.05_11-00-00_1.1.0.0.46657";
  writeFileSync(join(session, `${prefix} push-notifications_000.log`), PUSH);
  if (options.backend !== null) {
    writeFileSync(join(session, `${prefix} backend_000.log`), options.backend ?? BACKEND);
  }
  store = new ProgressStore(":memory:");
  return { root: tempDir, session };
}

describe("quest events are filed under the mode they happened in", () => {
  it("keeps PvE and PvP Season quests apart, even inside one session", () => {
    const { session } = setUp();

    applySessionToStore(session, store!);

    expect(store!.forMode("pve").getStatus(PVE_QUEST)).toBe("completed");
    expect(store!.forMode("pve").getStatus(LATE_PVE_QUEST)).toBe("accepted");
    expect(store!.forMode("pve").getStatus(SEASON_QUEST)).toBeNull();
    expect(store!.forMode("pvp-season").getStatus(SEASON_QUEST)).toBe("completed");
    expect(store!.forMode("pvp-season").getStatus(PVE_QUEST)).toBeNull();
    expect(store!.forMode("regular").getAllStatuses().size).toBe(0);
  });

  it("files a regular PvP session under regular PvP", () => {
    const backend = [request(at(11, 1), "gw-pvp", "/client/game/keepalive")].join("\n");
    const { session } = setUp({ backend });

    applySessionToStore(session, store!);

    expect(store!.forMode("regular").getAllStatuses().size).toBe(3);
    expect(store!.forMode("pve").getAllStatuses().size).toBe(0);
  });

  it("respects each mode's own reset boundary", () => {
    const { session } = setUp();
    store!.forMode("pvp-season").resetProgress(at(11, 45)); // the season character was reset after its quest

    applySessionToStore(session, store!);

    expect(store!.forMode("pvp-season").getStatus(SEASON_QUEST)).toBeNull();
    expect(store!.forMode("pve").getStatus(PVE_QUEST)).toBe("completed"); // PvE has no boundary
  });

  it("files everything under the fallback mode when the logs can't say (no backend log)", () => {
    const { session } = setUp({ backend: null });

    applySessionToStore(session, store!);
    expect(store!.forMode("pve").getAllStatuses().size).toBe(3);

    applySessionToStore(session, store!, { fallbackMode: "regular" });
    expect(store!.forMode("regular").getAllStatuses().size).toBe(3);
  });

  it("does the same through a full backfill", () => {
    const { root } = setUp();

    runBackfill(root, store!);

    expect(store!.forMode("pvp-season").getStatus(SEASON_QUEST)).toBe("completed");
    expect(store!.forMode("pve").getStatus(PVE_QUEST)).toBe("completed");
  });
});

describe("collectTaskEvents by mode", () => {
  it("labels every event with its mode", () => {
    const { root } = setUp();

    expect(collectTaskEvents(root).map((e) => [e.taskId, e.mode])).toEqual([
      [PVE_QUEST, "pve"],
      [SEASON_QUEST, "pvp-season"],
      [LATE_PVE_QUEST, "pve"],
    ]);
  });

  it("returns only one mode's events when asked", () => {
    const { root } = setUp();

    expect(collectTaskEvents(root, { mode: "pvp-season" }).map((e) => e.taskId)).toEqual([SEASON_QUEST]);
    expect(collectTaskEvents(root, { mode: "pve" }).map((e) => e.taskId)).toEqual([PVE_QUEST, LATE_PVE_QUEST]);
    expect(collectTaskEvents(root, { mode: "regular" })).toEqual([]);
  });
});
