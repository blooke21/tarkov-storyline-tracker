import { describe, it, expect } from "vitest";
import { bullets, clean, parseGuide, section } from "./wikitext.js";
import { SHOOTING_CANS } from "./__fixtures__/shootingCans.js";

describe("clean", () => {
  it("turns wiki markup into plain text", () => {
    expect(clean("Locate the [[NSV Utyos|Utyos machine gun]] on [[Ground Zero]] '''now''' {{note|x}}<br/>ok")).toBe(
      "Locate the Utyos machine gun on Ground Zero now ok"
    );
    expect(clean('[[Prapor]] Rep <font color="green">\'\'\'+0.1\'\'\'</font>')).toBe("Prapor Rep +0.1");
    expect(clean("see [https://example.test the site] [[File:x.png|thumb]]")).toBe("see the site");
  });
});

describe("section and bullets", () => {
  it("reads the text under a level-2 heading, and nothing from the next one", () => {
    expect(section(SHOOTING_CANS, "Objectives")).toContain("Eliminate any 5 targets");
    expect(section(SHOOTING_CANS, "Objectives")).not.toContain("EXP");
    expect(section(SHOOTING_CANS, "Missing")).toBeNull();
  });

  it("lists bullet points as plain text, dashing the nested ones and dropping quotes", () => {
    expect(bullets(SHOOTING_CANS, "Rewards")).toEqual([
      "+3,000 EXP",
      "Prapor Rep +0.1",
      "80,000 Roubles",
      "– 84,000 Roubles with Intelligence Center Level 1",
    ]);
    expect(bullets(SHOOTING_CANS, "Nothing")).toEqual([]);
  });
});

describe("parseGuide", () => {
  const parts = parseGuide(SHOOTING_CANS);

  it("makes an Overview from the text before the first heading, then one part per ===heading===", () => {
    expect(parts.map((p) => p.title)).toEqual(["Overview", "Utyos", "AGS"]);
    expect(parts[0].blocks).toEqual([{ kind: "text", text: "In this quest you have to find the Utyos machine gun on Ground Zero." }]);
  });

  it("collects gallery screenshots with their captions", () => {
    expect(parts[1].blocks).toEqual([
      { kind: "text", text: "The Utyos machine gun is located in an office on the third floor." },
      {
        kind: "images",
        images: [
          { file: "Shooting Cans Map.png", caption: "Location marked on map" },
          { file: "Tarbank Building.png", caption: "The Tarbank building" },
        ],
      },
    ]);
  });

  it("reads the quest-items table, bullet lists, deeper headings and inline images, and skips reward lists", () => {
    expect(parts[2].blocks).toEqual([
      { kind: "items", items: [{ name: "Dollars", amount: "2,000", note: "Handover item; must be found in raid" }] },
      { kind: "text", text: "Bring the item." },
      { kind: "list", items: ["Bullet one", "Bullet two"] },
      { kind: "heading", text: "Reserve" },
      { kind: "images", images: [{ file: "Reserve Map.jpg", caption: "Where on Reserve" }] },
    ]);
  });

  it("returns nothing for a page with no guide", () => {
    expect(parseGuide("==Objectives==\n* Do it\n")).toEqual([]);
  });
});
