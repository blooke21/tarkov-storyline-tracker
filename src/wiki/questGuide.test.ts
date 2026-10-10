import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createQuestGuideService, wikiPageTitle } from "./questGuide.js";
import { SHOOTING_CANS } from "./__fixtures__/shootingCans.js";

let tempDir: string | undefined;
afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});
const cacheDir = () => (tempDir = mkdtempSync(join(tmpdir(), "tarkov-wiki-test-")));

const LINK = "https://escapefromtarkov.fandom.com/wiki/Shooting_Cans";

/** A fake wiki: serves the page text and an image link for each known file. */
function fakeWiki(options: { page?: string | null; failing?: boolean } = {}) {
  const requests: URL[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push(url);
    expect((init?.headers as Record<string, string>)["User-Agent"]).toMatch(/TarkovStorylineTracker/);
    if (options.failing) {
      throw new TypeError("fetch failed");
    }
    if (url.searchParams.get("action") === "parse") {
      if (options.page === null) {
        return new Response(JSON.stringify({ error: { code: "missingtitle" } }));
      }
      return new Response(JSON.stringify({ parse: { wikitext: { "*": options.page ?? SHOOTING_CANS } } }));
    }
    const titles = (url.searchParams.get("titles") ?? "").split("|");
    const pages: Record<string, unknown> = {};
    titles.forEach((title, i) => {
      if (title === "File:Tarbank Building.png") return; // one screenshot the wiki doesn't have
      pages[i] = { title, imageinfo: [{ thumburl: `https://img.test/thumb/${encodeURIComponent(title)}`, url: `https://img.test/full/${encodeURIComponent(title)}` }] };
    });
    return new Response(JSON.stringify({ query: { pages } }));
  }) as typeof fetch;
  return { fetchImpl, requests };
}

describe("wikiPageTitle", () => {
  it("reads the page name from a wiki link", () => {
    expect(wikiPageTitle("https://escapefromtarkov.fandom.com/wiki/Cease_Fire!")).toBe("Cease Fire!");
    expect(wikiPageTitle("https://escapefromtarkov.fandom.com/wiki/To_Great_Heights!_-_Part_1")).toBe("To Great Heights! - Part 1");
    expect(wikiPageTitle("https://escapefromtarkov.fandom.com/wiki/Kruglov%27s_RFID_keycard#Notes")).toBe("Kruglov's RFID keycard");
  });

  it("refuses anything that isn't a link to that wiki's pages", () => {
    expect(wikiPageTitle(null)).toBeNull();
    expect(wikiPageTitle("https://evil.example/wiki/Debut")).toBeNull();
    expect(wikiPageTitle("https://escapefromtarkov.fandom.com/wiki/")).toBeNull();
  });
});

describe("createQuestGuideService", () => {
  it("builds the walkthrough: overview, parts, rewards, and screenshot links (dropping ones the wiki lacks)", async () => {
    const wiki = fakeWiki();
    const service = createQuestGuideService({ cacheDir: cacheDir(), fetchImpl: wiki.fetchImpl, minGapMs: 0 });

    const guide = (await service.get(LINK))!;

    expect(guide.found).toBe(true);
    expect(guide.wikiUrl).toBe(LINK);
    expect(guide.sections.map((s) => s.title)).toEqual(["Overview", "Utyos", "AGS", "Notes"]);
    expect(guide.rewards[0]).toBe("+3,000 EXP");
    const images = guide.sections[1].blocks.find((b) => b.kind === "images");
    expect(images).toEqual({
      kind: "images",
      images: [
        {
          url: "https://img.test/thumb/File%3AShooting%20Cans%20Map.png",
          full: "https://img.test/full/File%3AShooting%20Cans%20Map.png",
          caption: "Location marked on map",
        },
      ],
    });
    expect(guide.sections[3].blocks).toEqual([{ kind: "list", items: ["Stash the item and Skier helps.", "– A nested note"] }]);
  });

  it("saves what it fetched and serves the saved copy without asking the wiki again", async () => {
    const wiki = fakeWiki();
    const dir = cacheDir();
    const service = createQuestGuideService({ cacheDir: dir, fetchImpl: wiki.fetchImpl, minGapMs: 0 });

    await service.get(LINK);
    const calls = wiki.requests.length;
    const again = await service.get(LINK);

    expect(wiki.requests.length).toBe(calls);
    expect(again?.sections.length).toBeGreaterThan(0);
    expect(readdirSync(dir).filter((f) => f.endsWith(".json"))).toHaveLength(1);
  });

  it("asks again once the saved copy is two weeks old, but keeps the old one if the wiki is down", async () => {
    const dir = cacheDir();
    const first = createQuestGuideService({ cacheDir: dir, fetchImpl: fakeWiki().fetchImpl, minGapMs: 0, now: () => new Date("2026-10-01T00:00:00Z") });
    await first.get(LINK);

    const later = new Date("2026-10-20T00:00:00Z");
    const down = createQuestGuideService({ cacheDir: dir, fetchImpl: fakeWiki({ failing: true }).fetchImpl, minGapMs: 0, now: () => later });
    expect((await down.get(LINK))?.sections.length).toBeGreaterThan(0);

    const wiki = fakeWiki();
    const refreshed = createQuestGuideService({ cacheDir: dir, fetchImpl: wiki.fetchImpl, minGapMs: 0, now: () => later });
    await refreshed.get(LINK);
    expect(wiki.requests.length).toBeGreaterThan(0);
  });

  it("throws when the wiki is unreachable and there is no saved copy", async () => {
    const service = createQuestGuideService({ cacheDir: cacheDir(), fetchImpl: fakeWiki({ failing: true }).fetchImpl, minGapMs: 0 });

    await expect(service.get(LINK)).rejects.toThrow();
  });

  it("reports a page the wiki doesn't have as not found, and a bad link as null", async () => {
    const service = createQuestGuideService({ cacheDir: cacheDir(), fetchImpl: fakeWiki({ page: null }).fetchImpl, minGapMs: 0 });

    expect(await service.get(LINK)).toMatchObject({ found: false, sections: [], rewards: [] });
    expect(await service.get("https://evil.example/wiki/x")).toBeNull();
  });

  it("makes its requests one at a time, with a pause between them", async () => {
    let active = 0;
    let overlapped = false;
    const times: number[] = [];
    const inner = fakeWiki().fetchImpl;
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      active++;
      overlapped ||= active > 1;
      times.push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return inner(input, init);
    }) as typeof fetch;
    const service = createQuestGuideService({ cacheDir: cacheDir(), fetchImpl, minGapMs: 60 });

    await Promise.all([service.get(LINK), service.get("https://escapefromtarkov.fandom.com/wiki/Debut")]);

    expect(overlapped).toBe(false);
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(50);
    }
  });
});
