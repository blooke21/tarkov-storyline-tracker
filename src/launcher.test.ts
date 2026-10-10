import { describe, it, expect } from "vitest";
import { browserOpenCommand, isTrackerRunning, shouldOpenBrowser } from "./launcher.js";

describe("browserOpenCommand", () => {
  it("uses cmd's start on Windows, with an empty title so the URL isn't taken as one", () => {
    expect(browserOpenCommand("http://127.0.0.1:4173", "win32")).toEqual({
      command: "cmd",
      args: ["/c", "start", '""', "http://127.0.0.1:4173"],
    });
  });

  it("uses open on macOS and xdg-open elsewhere", () => {
    expect(browserOpenCommand("http://x", "darwin").command).toBe("open");
    expect(browserOpenCommand("http://x", "linux").command).toBe("xdg-open");
  });
});

describe("isTrackerRunning", () => {
  const json = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

  it("is true when the status endpoint answers like the tracker", async () => {
    expect(await isTrackerRunning(4173, json({ lastWatcherPollAt: null, progressSince: null }))).toBe(true);
  });

  it("is false when something else answers on that port", async () => {
    expect(await isTrackerRunning(4173, json({ hello: "world" }))).toBe(false);
    expect(await isTrackerRunning(4173, json({}, 404))).toBe(false);
  });

  it("is false when nothing is listening", async () => {
    const refused = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect(await isTrackerRunning(4173, refused)).toBe(false);
  });
});

describe("shouldOpenBrowser", () => {
  it("opens by default and can be switched off by flag or env var", () => {
    expect(shouldOpenBrowser(["node", "app.js"], {})).toBe(true);
    expect(shouldOpenBrowser(["node", "app.js", "--no-open"], {})).toBe(false);
    expect(shouldOpenBrowser(["node", "app.js"], { TARKOV_NO_OPEN: "1" })).toBe(false);
  });
});
