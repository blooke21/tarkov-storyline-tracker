// Rebuilds the story-chapter data from the Escape from Tarkov wiki:
//   src/storyChapters/chapters.ts  - each chapter's steps
//   src/storyChapters/guides.ts    - the wiki's walkthrough text and screenshot links for each chapter
//
// Run with:  node scripts/build-story-data.mjs [cache-dir]
//
// It uses the wiki's public MediaWiki API (about 10 page requests plus a few
// for image links, one per second, with an identifying User-Agent). The wiki's
// text is CC BY-SA; screenshots are not copied - the dashboard links to them on
// the wiki's own servers and credits the wiki. Pass a cache-dir to reuse
// downloads between runs.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://escapefromtarkov.fandom.com/api.php";
const WIKI = "https://escapefromtarkov.fandom.com/wiki/";
const UA = "TarkovStorylineTracker/0.1 (personal local tool; builds chapter data)";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = process.argv[2];

// Chapter order: Tour and Falling Skies first, The Ticket (the escape) last.
const CHAPTERS = [
  ["Tour", "Tour"],
  ["Falling Skies", "Falling_Skies"],
  ["Batya", "Batya"],
  ["The Unheard", "The_Unheard"],
  ["Blue Fire", "Blue_Fire"],
  ["They Are Already Here", "They_Are_Already_Here"],
  ["Accidental Witness", "Accidental_Witness"],
  ["The Labyrinth", "The_Labyrinth_(story_chapter)"],
  ["Boreas", "Boreas"],
  ["The Ticket", "The_Ticket"],
];
const UNLOCK_OVERRIDES = {
  Tour: "Added to your quest list automatically when you start the game.",
  "The Ticket": "The wiki doesn't list a trigger for this chapter — see its wiki page for how it starts.",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(params, cacheName) {
  const cachePath = cacheDir && join(cacheDir, cacheName);
  if (cachePath && existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, "utf8"));
  }
  const url = `${API}?${new URLSearchParams({ format: "json", ...params })}`;
  const response = await fetch(url, { headers: { "User-Agent": UA } });
  if (!response.ok) {
    throw new Error(`${response.status} from the wiki for ${cacheName}`);
  }
  const body = await response.json();
  if (cachePath) {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachePath, JSON.stringify(body));
  }
  await sleep(1000);
  return body;
}

// ---- wikitext helpers -------------------------------------------------------

function section(text, name) {
  const match = new RegExp(`^==\\s*${name}\\s*==\\s*$`, "m").exec(text);
  if (!match) return null;
  const rest = text.slice(match.index + match[0].length);
  const end = rest.search(/^==[^=]/m);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

/** Wiki markup -> plain text. */
function clean(value) {
  let text = value;
  for (let i = 0; i < 5; i++) text = text.replace(/\{\{[^{}]*\}\}/g, ""); // templates, innermost first
  return text
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "")
    .replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, "")
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, "$1")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/'''|''/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const IMAGE_FLAGS = /^(thumb|thumbnail|frame|frameless|left|right|center|none|border|\d+x?\d*px|x\d+px|link=.*|alt=.*|upright.*)$/i;

function imageRef(spec) {
  const [file, ...rest] = spec.split("|");
  const caption = clean(rest.filter((part) => !IMAGE_FLAGS.test(part.trim())).join(" "));
  return { file: file.trim().replace(/^(File|Image):/i, "").replace(/_/g, " "), caption };
}

function parseQuestItemTable(lines) {
  // Rows are "|-"-separated cells: icon, item name, amount, requirement, found in raid (Yes/No), optional notes.
  const rows = [];
  let current = [];
  for (const line of lines) {
    if (line.startsWith("|-")) {
      if (current.length) rows.push(current);
      current = [];
    } else if (/^[|!]/.test(line) && !line.startsWith("|}") && !line.startsWith("{|")) {
      current.push(clean(line.replace(/^[|!]+/, "")));
    }
  }
  if (current.length) rows.push(current);

  const items = [];
  for (const row of rows) {
    if (row.length < 5 || row.some((cell) => /^Item name$|Related Quest Items/i.test(cell))) continue;
    const [, name, amount, requirement, foundInRaid, note] = row;
    if (!name) continue;
    const notes = [requirement, /^yes$/i.test(foundInRaid) ? "must be found in raid" : "", note].filter((part) => part && part !== "N/A");
    items.push({ name, amount: amount || "", note: notes.join("; ") });
  }
  return items;
}

/** The wiki's Guide section -> [{ title, headings, blocks }] with one entry per level-3 heading. */
function parseGuide(wikitext) {
  const guide = section(wikitext, "Guide");
  if (!guide) return [];
  const sections = [];
  let current = null;
  const lines = guide.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = /^(={3,6})\s*(.*?)\s*\1\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const title = clean(heading[2]);
      if (level === 3) {
        current = { title, headings: [], blocks: [] };
        sections.push(current);
      } else if (current && !/^rewards?$/i.test(title)) {
        current.headings.push(title);
        current.blocks.push({ kind: "heading", text: title });
      } else if (current && /^rewards?$/i.test(title)) {
        // Skip the reward list that follows: it's content up to the next heading.
        while (i + 1 < lines.length && !/^={3,6}/.test(lines[i + 1])) i++;
      }
      continue;
    }
    if (!current) continue;

    if (line.startsWith("{|")) {
      const table = [];
      while (i < lines.length && !lines[i].startsWith("|}")) table.push(lines[i++]);
      if (table.some((row) => /Related Quest Items/i.test(row))) {
        const items = parseQuestItemTable(table);
        if (items.length) current.blocks.push({ kind: "items", items });
      }
      continue;
    }

    if (/<gallery/i.test(line)) {
      const images = [];
      while (i + 1 < lines.length && !/<\/gallery>/i.test(lines[i + 1])) {
        const entry = lines[++i].trim();
        if (/^(File|Image):/i.test(entry)) images.push(imageRef(entry));
      }
      if (images.length) current.blocks.push({ kind: "images", images });
      continue;
    }

    const inline = [...line.matchAll(/\[\[((?:File|Image):[^\]]*)\]\]/gi)].map((m) => imageRef(m[1]));
    const text = clean(line.replace(/^[*#:]+\s*/, ""));
    if (/^[*#]/.test(line) && text) {
      const last = current.blocks.at(-1);
      if (last?.kind === "list") last.items.push(text);
      else current.blocks.push({ kind: "list", items: [text] });
    } else if (text && !/^(thumb|\|)/.test(text)) {
      current.blocks.push({ kind: "text", text });
    }
    if (inline.length) current.blocks.push({ kind: "images", images: inline });
  }
  return sections.filter((s) => s.blocks.length > 0);
}

/** The Objectives bullet list -> [{ depth, optional, text }]. */
function parseObjectives(wikitext) {
  const objectives = [];
  for (const line of (section(wikitext, "Objectives") ?? "").split("\n")) {
    const match = /^([*#:]+)\s*(.*)$/.exec(line);
    if (!match) continue;
    const raw = match[2].trim();
    const optional = /^\(''Optional''\)|^\(Optional\)/i.test(raw);
    const text = clean(raw.replace(/^\(''Optional''\)\s*/i, "").replace(/^\(Optional\)\s*/i, ""));
    if (text) objectives.push({ depth: Math.min(match[1].length, 3), optional, text });
  }
  return objectives;
}

function unlockText(wikitext) {
  const requirements = section(wikitext, "Requirements");
  if (!requirements) return "";
  return clean(
    requirements
      .replace(/(?:File|Image):[^|\n]*\|[^*\n]*?(?=\s\*|\s(?:File|Image):|$)/gi, "")
      .replace(/^\*\s*/, "")
      .replace(/\s+\*\s+/g, " • ")
  );
}

// ---- matching steps to guide sections --------------------------------------

const STOP = new Set(
  ("the a an to of in on at for and or from with by any all your his her their it is be that this as you " +
    "talk hand over locate find obtain survive extract report ask wait reach access learn more about get use " +
    "read investigate tell contact visit return bring collect eliminate optional ensure").split(" ")
);
const tokens = (text) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word && !STOP.has(word) && (word.length > 1 || /\d/.test(word)))
  );

function similarity(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const word of a) if (b.has(word)) overlap++;
  // Mostly "is the shorter one contained in the longer", a little "are they the same size".
  return 0.7 * (overlap / Math.min(a.size, b.size)) + 0.3 * ((2 * overlap) / (a.size + b.size));
}

const MIN_MATCH = 0.5;

/**
 * For each objective, the index of the guide section that explains it, or
 * undefined before the first match. The guide follows the chapter's order, so
 * the matches are chosen together: the best set of main steps whose sections
 * never go backwards (a dynamic-programming alignment). A step with no good
 * match shares the section of the step before it, and a sub-step shares its
 * parent's.
 */
function matchObjectivesToGuide(objectives, sections) {
  const mains = objectives.map((o, i) => ({ o, i })).filter(({ o }) => o.depth === 1);
  const candidates = sections.map((s) =>
    [
      ...s.title.split("/").map((t) => ({ set: tokens(t), weight: 1 })),
      ...s.headings.map((t) => ({ set: tokens(t), weight: 0.9 })),
    ]
  );
  const sim = mains.map(({ o }) => {
    const mine = tokens(o.text);
    return sections.map((_, j) => Math.max(...candidates[j].map((c) => c.weight * similarity(mine, c.set))));
  });

  // position p: 0 = nothing matched yet, p = j + 1 = last matched section j.
  const P = sections.length + 1;
  const NEG = -Infinity;
  const best = [Array.from({ length: P }, (_, p) => (p === 0 ? 0 : NEG))];
  const back = [];
  mains.forEach((_, n) => {
    const prev = best[n];
    const row = Array.from({ length: P }, () => NEG);
    const from = Array.from({ length: P }, () => ({ p: -1, matched: false }));
    for (let p = 0; p < P; p++) {
      if (prev[p] > row[p]) {
        row[p] = prev[p];
        from[p] = { p, matched: false };
      }
    }
    for (let q = 1; q < P; q++) {
      const score = sim[n][q - 1];
      if (score < MIN_MATCH) continue;
      for (let p = 0; p <= q; p++) {
        if (prev[p] + score > row[q]) {
          row[q] = prev[p] + score;
          from[q] = { p, matched: true };
        }
      }
    }
    best.push(row);
    back.push(from);
  });

  let p = best[mains.length].indexOf(Math.max(...best[mains.length]));
  const matchedAt = new Array(mains.length).fill(-1); // section index where a step matched, else -1
  for (let n = mains.length - 1; n >= 0; n--) {
    if (back[n][p].matched) matchedAt[n] = p - 1;
    p = back[n][p].p;
  }

  // A step with no match of its own shares the guide section of the step before it,
  // but only when the next matched step is in the same or the very next section:
  // that means it sits inside that section's part of the walkthrough. Anything
  // further from a match (for instance a stretch of the chapter the wiki's guide
  // doesn't cover) gets no guide rather than a wrong one.
  const sectionOfMain = matchedAt.map((section, n) => {
    if (section >= 0) return section;
    let before;
    for (let k = n - 1; k >= 0 && before === undefined; k--) if (matchedAt[k] >= 0) before = matchedAt[k];
    let after;
    for (let k = n + 1; k < mains.length && after === undefined; k++) if (matchedAt[k] >= 0) after = matchedAt[k];
    if (before === undefined) return undefined;
    if (after === undefined) return before === sections.length - 1 ? before : undefined;
    return after - before <= 1 ? before : undefined;
  });

  const result = new Array(objectives.length).fill(undefined);
  mains.forEach(({ i }, n) => {
    result[i] = sectionOfMain[n];
  });
  let inherited;
  objectives.forEach((o, i) => {
    if (o.depth === 1) inherited = result[i];
    else result[i] = inherited;
  });
  return result;
}

// ---- screenshots ------------------------------------------------------------

async function imageUrls(files) {
  const urls = new Map();
  const names = [...files];
  for (let i = 0; i < names.length; i += 40) {
    const batch = names.slice(i, i + 40);
    const body = await api(
      {
        action: "query",
        prop: "imageinfo",
        iiprop: "url",
        iiurlwidth: "640",
        titles: batch.map((name) => `File:${name}`).join("|"),
      },
      `images-${i}.json`
    );
    const normalized = new Map((body.query.normalized ?? []).map((n) => [n.to, n.from]));
    for (const page of Object.values(body.query.pages ?? {})) {
      const info = page.imageinfo?.[0];
      if (!info) continue;
      const requested = (normalized.get(page.title) ?? page.title).replace(/^File:/, "").replace(/_/g, " ");
      urls.set(requested, { url: info.thumburl ?? info.url, full: info.url });
    }
  }
  return urls;
}

// ---- output -----------------------------------------------------------------

const q = (value) => JSON.stringify(value);
const slug = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const chapters = [];
for (const [title, path] of CHAPTERS) {
  const body = await api({ action: "parse", page: path, prop: "wikitext" }, `${path}.json`);
  const wikitext = body.parse.wikitext["*"].replace(/\r/g, "");
  const guide = parseGuide(wikitext);
  const objectives = parseObjectives(wikitext);
  chapters.push({
    id: slug(title),
    name: title,
    wikiUrl: WIKI + path,
    unlock: UNLOCK_OVERRIDES[title] ?? unlockText(wikitext),
    objectives,
    guide,
    guideFor: matchObjectivesToGuide(objectives, guide),
  });
  console.log(`${title}: ${objectives.length} steps, ${guide.length} guide sections`);
}

const wanted = new Set(
  chapters.flatMap((c) => c.guide.flatMap((s) => s.blocks.filter((b) => b.kind === "images").flatMap((b) => b.images.map((i) => i.file))))
);
const urls = await imageUrls(wanted);
let missing = 0;

let chaptersTs = `import type { StoryChapter } from "./types.js";

/**
 * Story chapters and their main steps. Tour and Falling Skies come first and
 * The Ticket (the escape) last; the others have no fixed order.
 *
 * GENERATED by scripts/build-story-data.mjs from the Escape from Tarkov wiki
 * (https://escapefromtarkov.fandom.com/wiki/Story_chapters, CC BY-SA), because
 * tarkov.dev's quest data doesn't include story chapters and the game never
 * writes them to its logs. Re-run the script to refresh it. Each chapter links
 * back to its wiki page, which is the source of truth if the game changes.
 *
 * depth 1 is a main step, 2+ a sub-step. "guide" is the index of the section in
 * guides.ts that walks the player through the step.
 */
export const STORY_CHAPTERS: StoryChapter[] = [
`;
for (const chapter of chapters) {
  chaptersTs += `  {\n    id: ${q(chapter.id)},\n    name: ${q(chapter.name)},\n    wikiUrl: ${q(chapter.wikiUrl)},\n    unlock: ${q(chapter.unlock)},\n    objectives: [\n`;
  chapter.objectives.forEach((o, i) => {
    const guide = chapter.guideFor[i];
    chaptersTs += `      { depth: ${o.depth}, optional: ${o.optional}, text: ${q(o.text)}${guide === undefined ? "" : `, guide: ${guide}`} },\n`;
  });
  chaptersTs += `    ],\n  },\n`;
}
chaptersTs += "];\n";

let guidesTs = `import type { GuideSection } from "./types.js";

/**
 * Walkthrough text and screenshot links for each story chapter, from the wiki
 * (CC BY-SA) — GENERATED by scripts/build-story-data.mjs, do not edit by hand.
 * Screenshots are links to the wiki's own servers, not copies.
 */
export const CHAPTER_GUIDES: Record<string, GuideSection[]> = {
`;
for (const chapter of chapters) {
  guidesTs += `  ${q(chapter.id)}: [\n`;
  for (const s of chapter.guide) {
    const blocks = s.blocks
      .map((block) => {
        if (block.kind !== "images") return block;
        const images = block.images
          .map((image) => {
            const link = urls.get(image.file);
            if (!link) {
              missing++;
              return null;
            }
            return { url: link.url, full: link.full, caption: image.caption };
          })
          .filter(Boolean);
        return images.length ? { kind: "images", images } : null;
      })
      .filter(Boolean);
    guidesTs += `    { title: ${q(s.title)}, blocks: ${JSON.stringify(blocks)} },\n`;
  }
  guidesTs += `  ],\n`;
}
guidesTs += "};\n";

writeFileSync(join(ROOT, "src/storyChapters/chapters.ts"), chaptersTs);
writeFileSync(join(ROOT, "src/storyChapters/guides.ts"), guidesTs);
console.log(`wrote chapters.ts and guides.ts (${urls.size} screenshots linked, ${missing} not found on the wiki)`);

// A readable view of the step -> guide matching, for checking by eye.
if (process.argv.includes("--review")) {
  for (const chapter of chapters) {
    console.log(`\n## ${chapter.name}`);
    chapter.objectives.forEach((o, i) => {
      if (o.depth === 1) console.log(`  ${o.text.slice(0, 55).padEnd(55)} -> ${chapter.guideFor[i] === undefined ? "-" : chapter.guide[chapter.guideFor[i]].title.slice(0, 50)}`);
    });
  }
}
