export interface ChapterObjective {
  /** 1 = a main step, 2+ = a sub-step of the step above it. */
  depth: 1 | 2 | 3;
  optional: boolean;
  text: string;
  /** Index of the walkthrough section (in guides.ts) that explains this step, if the wiki has one. */
  guide?: number;
}

export interface StoryChapter {
  id: string;
  name: string;
  wikiUrl: string;
  /** How the chapter starts, in the wiki's words. */
  unlock: string;
  objectives: ChapterObjective[];
}

export interface GuideItem {
  name: string;
  amount: string;
  note: string;
}

export interface GuideImage {
  /** A scaled-down copy served by the wiki. */
  url: string;
  /** The full-size image on the wiki. */
  full: string;
  caption: string;
}

export type GuideBlock =
  | { kind: "text"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "heading"; text: string }
  | { kind: "items"; items: GuideItem[] }
  | { kind: "images"; images: GuideImage[] };

/** One part of a chapter's walkthrough: a wiki guide heading and what's under it. */
export interface GuideSection {
  title: string;
  blocks: GuideBlock[];
}
