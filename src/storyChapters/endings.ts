/**
 * The choices and endings in the story chapters, summarized from the Escape from Tarkov wiki
 * (https://escapefromtarkov.fandom.com/wiki/Story_chapters, CC BY-SA). The quest data doesn't include chapters,
 * so, like the chapters themselves, this is kept by hand. The wiki page for each chapter is the source of truth.
 */
export interface ChapterChoice {
  /** What the player is deciding and why it matters. */
  summary: string;
  /** The ways it can go. Empty when the choices that matter were made elsewhere. */
  options: Array<{ label: string; detail: string }>;
}

export const CHAPTER_CHOICES: Record<string, ChapterChoice> = {
  "falling-skies": {
    summary:
      "At the end you decide what to do with the armored case. The choice carries into later chapters: The Ticket and Boreas follow different routes depending on whether you gave Prapor the case or kept it.",
    options: [
      { label: "Keep the armored case", detail: "Prapor's reputation drops by 0.7 and you keep the case (achievement: Just Business)." },
      { label: "Hand it over to Prapor", detail: "You are paid 1,000,000 roubles (achievement: Man of His Word)." },
      { label: "Pretend you didn't find it, but still hand it over", detail: "The same rewards as handing it over directly." },
    ],
  },
  "blue-fire": {
    summary: "Near the end you choose what happens to the fragment of Item 1156.",
    options: [
      { label: "Keep the fragment", detail: "Unlocks the achievement Better Served." },
      { label: "Hand it over to Mechanic", detail: "You are paid 1,500,000 roubles." },
    ],
  },
  boreas: {
    summary:
      "Boreas has no choice of its own, but its steps change with earlier choices: whether you gave or kept the armored case in Falling Skies (or never finished it), and whether you completed The Price of Independence or Choose Your Friends Wisely (two trader quests that exclude each other).",
    options: [],
  },
  "the-ticket": {
    summary:
      "The story has four endings. Which one you get depends on whether you accept Mr. Kerman's offer, whether you agree to find evidence on TerraGroup for him, and how much of it you hand in. Earlier choices (the armored case in Falling Skies, the evidence from They Are Already Here) also change the steps on the way.",
    options: [
      { label: "Savior ending", detail: "Accept Mr. Kerman's offer and agree to find evidence on TerraGroup." },
      { label: "Debtor ending", detail: "Accept the offer and agree to find evidence, but refuse to hand in more than 2 pieces of major evidence." },
      { label: "Fallen ending", detail: "Accept the offer, but refuse to find evidence on TerraGroup." },
      { label: "Survivor ending", detail: "Refuse Mr. Kerman's offer." },
    ],
  },
};
