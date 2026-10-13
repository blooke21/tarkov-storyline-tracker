import { describe, it, expect } from "vitest";
import { extractModeMarkers, modeAt } from "./modeTimeline.js";

// Real-format backend log lines (trimmed) from a session where the player switched PvE -> PvP Season -> PvE (2026-08-05).
const line = (time: string, host: string, path: string, kind = "Request") =>
  `2026-08-05 ${time}|1.1.0.0.46657|Info|backend|${kind === "Request" ? "--->" : "<---"} ${kind} HTTPS, id [7]: URL: https://${host}.escapefromtarkov.com${path}. `;

const SESSION = [
  // Every session starts by asking the regular-PvP server which mode the account is in; that isn't gameplay.
  line("11:12:45.480", "gw-pvp", "/client/game/mode"),
  line("11:12:45.800", "gw-pve", "/client/game/start"),
  line("11:13:28.000", "gw-pve", "/client/game/keepalive"),
  line("11:40:50.000", "gw-pve", "/client/game/profile/items/moving"),
  line("11:41:06.000", "gw-pvp-season", "/client/game/keepalive"),
  line("11:45:00.000", "gw-pvp-season", "/client/trading/api/getTraderAssort/54cb50c76803fa8b248b4571"),
  line("11:51:58.000", "gw-pve", "/client/game/keepalive"),
  // A response line, not a request: ignored.
  line("11:52:30.000", "gw-pvp-season", "/client/game/keepalive", "Response"),
].join("\n");

const at = (time: string) => new Date(`2026-08-05T${time}`);

describe("extractModeMarkers", () => {
  it("reads the mode from the server each gameplay request goes to, ignoring the startup mode lookup and responses", () => {
    const markers = extractModeMarkers(SESSION);

    expect(markers.map((m) => m.mode)).toEqual(["pve", "pve", "pve", "pvp-season", "pvp-season", "pve"]);
  });

  it("treats the regular PvP server as regular PvP when gameplay really goes to it", () => {
    const text = line("20:00:00.000", "gw-pvp", "/client/game/keepalive");

    expect(extractModeMarkers(text).map((m) => m.mode)).toEqual(["regular"]);
  });

  it("copes with numbered gateways and with lines that aren't requests", () => {
    const text = ["noise", line("09:00:00.000", "gw-pve-02", "/client/game/keepalive"), "2026-08-05 09:00:01.000|1|Info|backend|Request HTTPS, broken"].join("\n");

    expect(extractModeMarkers(text).map((m) => m.mode)).toEqual(["pve"]);
  });

  it("returns nothing for a log with no gameplay traffic", () => {
    expect(extractModeMarkers("")).toEqual([]);
    expect(extractModeMarkers(line("11:12:45.480", "gw-pvp", "/client/game/mode"))).toEqual([]);
  });
});

describe("modeAt", () => {
  const markers = extractModeMarkers(SESSION);

  it("is the mode of the last gameplay request before the moment", () => {
    expect(modeAt(markers, at("11:30:00"), "regular")).toBe("pve");
    expect(modeAt(markers, at("11:43:00"), "pve")).toBe("pvp-season");
    expect(modeAt(markers, at("11:56:00"), "pvp-season")).toBe("pve");
  });

  it("switches exactly at a request's time", () => {
    expect(modeAt(markers, at("11:41:05"), "regular")).toBe("pve");
    expect(modeAt(markers, at("11:41:06"), "regular")).toBe("pvp-season");
  });

  it("uses the first request's mode for a moment before any request", () => {
    expect(modeAt(markers, at("10:00:00"), "regular")).toBe("pve");
  });

  it("uses the fallback when there's no traffic to go by", () => {
    expect(modeAt([], at("11:00:00"), "regular")).toBe("regular");
  });
});
