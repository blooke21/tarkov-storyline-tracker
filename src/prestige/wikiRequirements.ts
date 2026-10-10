import type { GameMode } from "../tarkovData/gameMode.js";
import type { PrestigeCondition } from "./prestigeData.js";

/**
 * Prestige requirements the tarkov.dev feed leaves out: the "New Beginning"
 * quest for each level, finishing story chapters, and picking up the Ticket.
 * From the wiki's prestige table (https://escapefromtarkov.fandom.com/wiki/Prestige,
 * CC BY-SA) — keep it in step with that page if the game changes. (The feed
 * already covers player level, skills, hideout, money and the Collector quest.)
 */
const CHAPTERS_NEEDED: Record<number, string[]> = {
  2: ["tour"],
  3: ["tour", "falling-skies"],
  4: ["tour"],
  5: ["tour", "they-are-already-here"],
  6: ["the-ticket"],
};

const NEEDS_TICKET = new Set([4, 5]);

export function wikiRequirements(level: number, gameMode: GameMode): PrestigeCondition[] {
  const requirements: PrestigeCondition[] = [];

  // In PvE the first prestige has no New Beginning quest; every later one does.
  if (level >= 2 || gameMode === "regular") {
    requirements.push({
      id: `wiki-new-beginning-${level}`,
      kind: "other",
      text: `Complete the quest "New Beginning (Prestige ${level})"`,
    });
  }
  for (const chapterId of CHAPTERS_NEEDED[level] ?? []) {
    requirements.push({ id: `wiki-chapter-${level}-${chapterId}`, kind: "chapter", chapterId });
  }
  if (NEEDS_TICKET.has(level)) {
    requirements.push({
      id: `wiki-ticket-${level}`,
      kind: "other",
      text: "Obtain the Ticket from Tarkov (Kruglov's RFID keycard) in the story",
    });
  }
  return requirements;
}
