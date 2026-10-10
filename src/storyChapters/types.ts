export interface ChapterObjective {
  /** 1 = a main step, 2+ = a sub-step of the step above it. */
  depth: 1 | 2 | 3;
  optional: boolean;
  text: string;
}

export interface StoryChapter {
  id: string;
  name: string;
  wikiUrl: string;
  /** How the chapter starts, in the wiki's words. */
  unlock: string;
  objectives: ChapterObjective[];
}
