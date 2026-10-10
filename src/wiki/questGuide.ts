import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GuideBlock, GuideSection } from "../storyChapters/types.js";
import { bullets, parseGuide } from "./wikitext.js";
import type { RawBlock } from "./wikitext.js";

const API = "https://escapefromtarkov.fandom.com/api.php";
const WIKI_PAGE = "https://escapefromtarkov.fandom.com/wiki/";
const USER_AGENT = "TarkovStorylineTracker/0.1 (personal local tool; reads quest guides)";
const CACHE_VERSION = 1;
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

export interface QuestGuide {
  /** The quest's wiki page. */
  wikiUrl: string;
  /** False if the wiki has no page under this name. */
  found: boolean;
  /** Overview, per-part walkthrough, and notes — text and screenshot links. */
  sections: GuideSection[];
  /** What the quest pays out, as the wiki lists it. */
  rewards: string[];
}

export interface QuestGuideOptions {
  /** Where fetched guides are kept between runs. */
  cacheDir: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Minimum pause between requests to the wiki. */
  minGapMs?: number;
  maxAgeMs?: number;
}

interface CacheFile {
  version: number;
  fetchedAt: string;
  guide: QuestGuide;
}

/** "https://…/wiki/Cease_Fire!" -> "Cease Fire!" (null for anything that isn't a wiki page link). */
export function wikiPageTitle(wikiLink: string | null): string | null {
  if (!wikiLink || !wikiLink.startsWith(WIKI_PAGE)) {
    return null;
  }
  try {
    const title = decodeURIComponent(wikiLink.slice(WIKI_PAGE.length).split(/[?#]/)[0]).replace(/_/g, " ").trim();
    return title || null;
  } catch {
    return null;
  }
}

function cacheName(title: string): string {
  return `${encodeURIComponent(title).replace(/%/g, "_").slice(0, 150)}.json`;
}

export function createQuestGuideService(options: QuestGuideOptions) {
  const { cacheDir, fetchImpl = fetch, now = () => new Date(), minGapMs = 1000, maxAgeMs = TWO_WEEKS_MS } = options;

  // One request at a time, with a pause between them: this talks to a community-run wiki.
  let queue: Promise<unknown> = Promise.resolve();
  let lastRequestAt = 0;
  function politely<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(async () => {
      const wait = lastRequestAt + minGapMs - Date.now();
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      lastRequestAt = Date.now();
      return task();
    });
    queue = run.catch(() => undefined);
    return run;
  }

  async function call(params: Record<string, string>): Promise<any> {
    const url = `${API}?${new URLSearchParams({ format: "json", ...params })}`;
    const response = await politely(() => fetchImpl(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(30_000) }));
    if (!response.ok) {
      throw new Error(`The wiki answered ${response.status}`);
    }
    return response.json();
  }

  async function imageLinks(files: string[]): Promise<Map<string, { url: string; full: string }>> {
    const links = new Map<string, { url: string; full: string }>();
    for (let i = 0; i < files.length; i += 40) {
      const batch = files.slice(i, i + 40);
      const body = await call({
        action: "query",
        prop: "imageinfo",
        iiprop: "url",
        iiurlwidth: "640",
        titles: batch.map((name) => `File:${name}`).join("|"),
      });
      const normalized = new Map<string, string>((body.query?.normalized ?? []).map((n: { from: string; to: string }) => [n.to, n.from]));
      for (const page of Object.values<any>(body.query?.pages ?? {})) {
        const info = page.imageinfo?.[0];
        if (info) {
          const requested = String(normalized.get(page.title) ?? page.title).replace(/^File:/, "").replace(/_/g, " ");
          links.set(requested, { url: info.thumburl ?? info.url, full: info.url });
        }
      }
    }
    return links;
  }

  async function download(title: string): Promise<QuestGuide> {
    const wikiUrl = WIKI_PAGE + encodeURIComponent(title.replace(/ /g, "_")).replace(/%21/g, "!").replace(/%28/g, "(").replace(/%29/g, ")");
    const body = await call({ action: "parse", page: title, prop: "wikitext", redirects: "1" });
    if (body.error) {
      if (body.error.code === "missingtitle") {
        return { wikiUrl, found: false, sections: [], rewards: [] };
      }
      throw new Error(`The wiki couldn't give the page: ${body.error.code ?? "unknown error"}`);
    }
    const wikitext: string = String(body.parse?.wikitext?.["*"] ?? "").replace(/\r/g, "");

    const raw = parseGuide(wikitext);
    const notes = bullets(wikitext, "Notes");
    if (notes.length) {
      raw.push({ title: "Notes", blocks: [{ kind: "list", items: notes }] });
    }

    const files = [...new Set(raw.flatMap((part) => part.blocks.flatMap((block) => (block.kind === "images" ? block.images.map((image) => image.file) : []))))];
    const links = files.length ? await imageLinks(files) : new Map();

    const sections: GuideSection[] = raw
      .map((part) => ({
        title: part.title,
        blocks: part.blocks
          .map((block: RawBlock): GuideBlock | null => {
            if (block.kind !== "images") {
              return block;
            }
            const images = block.images.flatMap((image) => {
              const link = links.get(image.file);
              return link ? [{ url: link.url, full: link.full, caption: image.caption }] : [];
            });
            return images.length ? { kind: "images", images } : null;
          })
          .filter((block): block is GuideBlock => block !== null),
      }))
      .filter((part) => part.blocks.length > 0);

    return { wikiUrl, found: true, sections, rewards: bullets(wikitext, "Rewards") };
  }

  function readCache(path: string): CacheFile | null {
    if (!existsSync(path)) {
      return null;
    }
    try {
      const cache = JSON.parse(readFileSync(path, "utf-8")) as Partial<CacheFile>;
      return cache.version === CACHE_VERSION && typeof cache.fetchedAt === "string" && cache.guide ? (cache as CacheFile) : null;
    } catch {
      return null;
    }
  }

  return {
    /** The wiki's guide for a quest page, from the saved copy if it's under two weeks old. Throws if the wiki can't be reached and there's no saved copy. */
    async get(wikiLink: string | null): Promise<QuestGuide | null> {
      const title = wikiPageTitle(wikiLink);
      if (!title) {
        return null;
      }
      const path = join(cacheDir, cacheName(title));
      const cached = readCache(path);
      if (cached && now().getTime() - new Date(cached.fetchedAt).getTime() < maxAgeMs) {
        return cached.guide;
      }
      try {
        const guide = await download(title);
        mkdirSync(cacheDir, { recursive: true });
        const file: CacheFile = { version: CACHE_VERSION, fetchedAt: now().toISOString(), guide };
        writeFileSync(`${path}.tmp`, JSON.stringify(file), "utf-8");
        renameSync(`${path}.tmp`, path);
        return guide;
      } catch (error) {
        if (cached) {
          return cached.guide;
        }
        throw error;
      }
    },
  };
}
