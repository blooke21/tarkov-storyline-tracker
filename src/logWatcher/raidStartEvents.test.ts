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

  it("ignores a GameStarted line with no preceding profileStatus at all in the file", () => {
    const text = "2026-05-31 19:15:31.816|1.0.5.0.45272|Info|application|GameStarted:1(0) real:1(0) diff:0";

    expect(extractRaidStartEvents(text)).toEqual([]);
  });
});
