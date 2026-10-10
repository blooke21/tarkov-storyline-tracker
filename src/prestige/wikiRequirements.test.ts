import { describe, it, expect } from "vitest";
import { wikiRequirements } from "./wikiRequirements.js";

const texts = (level: number, mode: "pve" | "regular") =>
  wikiRequirements(level, mode).map((c) => (c.kind === "other" ? c.text : `${c.kind}:${"chapterId" in c ? c.chapterId : ""}`));

describe("wikiRequirements", () => {
  it("has nothing extra for the first PvE prestige, but a New Beginning quest in regular", () => {
    expect(texts(1, "pve")).toEqual([]);
    expect(texts(1, "regular")).toEqual(['Complete the quest "New Beginning (Prestige 1)"']);
  });

  it("asks for each later level's New Beginning quest and the story chapters, per the wiki's table", () => {
    expect(texts(2, "pve")).toEqual(['Complete the quest "New Beginning (Prestige 2)"', "chapter:tour"]);
    expect(texts(3, "pve")).toEqual(['Complete the quest "New Beginning (Prestige 3)"', "chapter:tour", "chapter:falling-skies"]);
    expect(texts(5, "pve")).toEqual([
      'Complete the quest "New Beginning (Prestige 5)"',
      "chapter:tour",
      "chapter:they-are-already-here",
      "Obtain the Ticket from Tarkov (Kruglov's RFID keycard) in the story",
    ]);
    expect(texts(6, "pve")).toContain("chapter:the-ticket");
  });

  it("gives every requirement a unique id, so ticking one never ticks another", () => {
    const ids = [1, 2, 3, 4, 5, 6].flatMap((level) => wikiRequirements(level, "regular").map((c) => c.id));

    expect(new Set(ids).size).toBe(ids.length);
  });
});
