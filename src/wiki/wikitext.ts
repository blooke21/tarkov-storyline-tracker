import type { GuideBlock } from "../storyChapters/types.js";

/**
 * Just enough of MediaWiki's markup to read the Escape from Tarkov wiki's quest
 * pages (text there is CC BY-SA). Not a general wikitext parser.
 */

/** The text under a level-2 heading ("==Guide=="), up to the next level-2 heading, or null if there isn't one. */
export function section(wikitext: string, name: string): string | null {
  const match = new RegExp(`^==\\s*${name}\\s*==\\s*$`, "m").exec(wikitext);
  if (!match) {
    return null;
  }
  const rest = wikitext.slice(match.index + match[0].length);
  const end = rest.search(/^==[^=]/m);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

/** Wiki markup -> plain text: links, bold/italic, templates, HTML tags and images are stripped. */
export function clean(value: string): string {
  let text = value;
  for (let i = 0; i < 5; i++) {
    text = text.replace(/\{\{[^{}]*\}\}/g, ""); // templates, innermost first
  }
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

export interface ImageRef {
  file: string;
  caption: string;
}

const IMAGE_FLAGS = /^(thumb|thumbnail|frame|frameless|left|right|center|none|border|\d+x?\d*px|x\d+px|link=.*|alt=.*|upright.*)$/i;

function imageRef(spec: string): ImageRef {
  const [file, ...rest] = spec.split("|");
  const caption = clean(rest.filter((part) => !IMAGE_FLAGS.test(part.trim())).join(" "));
  return { file: file.trim().replace(/^(File|Image):/i, "").replace(/_/g, " "), caption };
}

/** A guide block whose images are still wiki file names (they become links once resolved). */
export type RawBlock = Exclude<GuideBlock, { kind: "images" }> | { kind: "images"; images: ImageRef[] };

export interface RawSection {
  title: string;
  blocks: RawBlock[];
}

function parseQuestItemTable(lines: string[]): Array<{ name: string; amount: string; note: string }> {
  // Rows are "|-"-separated cells: icon, item name, amount, requirement, found in raid (Yes/No), optional notes.
  const rows: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.startsWith("|-")) {
      if (current.length) rows.push(current);
      current = [];
    } else if (/^[|!]/.test(line) && !line.startsWith("|}") && !line.startsWith("{|")) {
      current.push(clean(line.replace(/^[|!]+/, "")));
    }
  }
  if (current.length) rows.push(current);

  const items: Array<{ name: string; amount: string; note: string }> = [];
  for (const row of rows) {
    if (row.length < 5 || row.some((cell) => /^Item name$|Related Quest Items/i.test(cell))) continue;
    const [, name, amount, requirement, foundInRaid, note] = row;
    if (!name) continue;
    const notes = [requirement, /^yes$/i.test(foundInRaid) ? "must be found in raid" : "", note].filter((part) => part && part !== "N/A");
    items.push({ name, amount: amount || "", note: notes.join("; ") });
  }
  return items;
}

/**
 * The wiki's "Guide" section as walkthrough parts. Text before the first
 * "===heading===" becomes an "Overview" part; each level-3 heading starts a
 * part, and deeper headings are headings inside it.
 */
export function parseGuide(wikitext: string): RawSection[] {
  const guide = section(wikitext, "Guide");
  if (!guide) {
    return [];
  }
  const sections: RawSection[] = [];
  let current: RawSection = { title: "Overview", blocks: [] };
  sections.push(current);

  const lines = guide.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = /^(={3,6})\s*(.*?)\s*\1\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const title = clean(heading[2]);
      if (/^rewards?$/i.test(title)) {
        // Skip the reward list under it: content up to the next heading.
        while (i + 1 < lines.length && !/^={3,6}/.test(lines[i + 1])) i++;
      } else if (level === 3) {
        current = { title, blocks: [] };
        sections.push(current);
      } else {
        current.blocks.push({ kind: "heading", text: title });
      }
      continue;
    }

    if (line.startsWith("{|")) {
      const table: string[] = [];
      while (i < lines.length && !lines[i].startsWith("|}")) table.push(lines[i++]);
      if (table.some((row) => /Related Quest Items/i.test(row))) {
        const items = parseQuestItemTable(table);
        if (items.length) current.blocks.push({ kind: "items", items });
      }
      continue;
    }

    if (/<gallery/i.test(line)) {
      const images: ImageRef[] = [];
      while (i + 1 < lines.length && !/<\/gallery>/i.test(lines[i + 1])) {
        const entry = lines[++i].trim();
        if (/^(File|Image):/i.test(entry)) images.push(imageRef(entry));
      }
      if (images.length) current.blocks.push({ kind: "images", images });
      continue;
    }

    const inline = [...line.matchAll(/\[\[((?:File|Image):[^\]]*)\]\]/gi)].map((match) => imageRef(match[1]));
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
  return sections.filter((part) => part.blocks.length > 0);
}

/** Bullet points under a level-2 heading as plain text (nested bullets are marked with a dash). */
export function bullets(wikitext: string, name: string): string[] {
  const body = section(wikitext, name);
  if (!body) {
    return [];
  }
  const items: string[] = [];
  for (const line of body.split("\n")) {
    const match = /^([*#]+)\s*(.*)$/.exec(line);
    const text = match ? clean(match[2]) : "";
    if (text) {
      items.push(match![1].length > 1 ? `– ${text}` : text);
    }
  }
  return items;
}
