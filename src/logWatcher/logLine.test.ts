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

  it("parses a real current-format line that also carries a timezone offset (seen on this machine in Nov 2025 builds)", () => {
    const line = "2025-11-15 11:47:42.290 -06:00|1.0.0.0.41760|Info|application|Application awaken, updateQueue:'Update'";

    expect(parseLogLine(line)).toEqual({
      date: "2025-11-15",
      time: "11:47:42.290",
      version: "1.0.0.0.41760",
      level: "Info",
      logType: "application",
      message: "Application awaken, updateQueue:'Update'",
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
