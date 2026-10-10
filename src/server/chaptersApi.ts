import { HttpError } from "./createServer.js";
import type { ProgressStore } from "../progress/store.js";
import type { ChapterObjective, StoryChapter } from "../storyChapters/types.js";
import { STORY_CHAPTERS_META_KEY } from "../progress/store.js";

export type ChapterStatus = "not-started" | "active" | "done";

interface SavedChapter {
  active: boolean;
  finished: boolean;
  /** Indexes into the chapter's objectives that the player has ticked off. */
  done: number[];
}

type SavedProgress = Record<string, SavedChapter>;

export interface ChapterObjectiveView extends ChapterObjective {
  index: number;
  done: boolean;
}

export interface ChapterView {
  id: string;
  name: string;
  wikiUrl: string;
  unlock: string;
  status: ChapterStatus;
  objectives: ChapterObjectiveView[];
  /** Required main steps ticked off, out of all required main steps. */
  doneSteps: number;
  totalSteps: number;
  /** Index of the first required main step not done yet — what to do next — or null. */
  currentIndex: number | null;
}

export interface ChaptersResponse {
  chapters: ChapterView[];
}

export interface ChaptersApiDeps {
  store: ProgressStore;
  chapters: StoryChapter[];
}

const STATUSES: ChapterStatus[] = ["not-started", "active", "done"];

function readSaved(store: ProgressStore): SavedProgress {
  const raw = store.getMeta(STORY_CHAPTERS_META_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as SavedProgress) : {};
  } catch {
    return {};
  }
}

function findChapter(deps: ChaptersApiDeps, id: string | null): StoryChapter {
  const chapter = deps.chapters.find((candidate) => candidate.id === id);
  if (!chapter) {
    throw new HttpError(404, `Unknown story chapter "${id ?? ""}"`);
  }
  return chapter;
}

function viewOf(chapter: StoryChapter, saved: SavedChapter | undefined): ChapterView {
  const doneSet = new Set(saved?.done ?? []);
  const objectives = chapter.objectives.map((objective, index) => ({
    ...objective,
    index,
    done: doneSet.has(index),
  }));
  const requiredSteps = objectives.filter((objective) => objective.depth === 1 && !objective.optional);
  const next = requiredSteps.find((objective) => !objective.done);

  let status: ChapterStatus = "not-started";
  if (saved?.finished) {
    status = "done";
  } else if (saved?.active || doneSet.size > 0) {
    status = "active";
  }

  return {
    id: chapter.id,
    name: chapter.name,
    wikiUrl: chapter.wikiUrl,
    unlock: chapter.unlock,
    status,
    objectives,
    doneSteps: requiredSteps.filter((objective) => objective.done).length,
    totalSteps: requiredSteps.length,
    currentIndex: next ? next.index : null,
  };
}

export function buildChaptersResponse(deps: ChaptersApiDeps): ChaptersResponse {
  const saved = readSaved(deps.store);
  return { chapters: deps.chapters.map((chapter) => viewOf(chapter, saved[chapter.id])) };
}

function update(deps: ChaptersApiDeps, chapterId: string, change: (current: SavedChapter) => SavedChapter): ChaptersResponse {
  const saved = readSaved(deps.store);
  const current = saved[chapterId] ?? { active: false, finished: false, done: [] };
  saved[chapterId] = change(current);
  deps.store.setMeta(STORY_CHAPTERS_META_KEY, JSON.stringify(saved));
  return buildChaptersResponse(deps);
}

/** Sets where the player is in a chapter. "not-started" also forgets every step they ticked off. */
export function setChapterStatus(deps: ChaptersApiDeps, chapterId: string | null, status: string | null): ChaptersResponse {
  const chapter = findChapter(deps, chapterId);
  if (!STATUSES.includes(status as ChapterStatus)) {
    throw new HttpError(400, `status must be one of ${STATUSES.join(", ")}`);
  }
  return update(deps, chapter.id, (current) => {
    if (status === "not-started") {
      return { active: false, finished: false, done: [] };
    }
    return { ...current, active: true, finished: status === "done" };
  });
}

/**
 * Ticks a step off (or back on). A main step carries its sub-steps with it —
 * ticking "Ensure access to Reserve" also ticks everything listed under it.
 */
export function setObjectiveDone(
  deps: ChaptersApiDeps,
  chapterId: string | null,
  indexParam: string | null,
  done: boolean
): ChaptersResponse {
  const chapter = findChapter(deps, chapterId);
  const index = Number(indexParam);
  if (indexParam === null || !Number.isInteger(index) || index < 0 || index >= chapter.objectives.length) {
    throw new HttpError(400, `index must be a whole number from 0 to ${chapter.objectives.length - 1}`);
  }

  const group = [index];
  for (let i = index + 1; i < chapter.objectives.length && chapter.objectives[i].depth > chapter.objectives[index].depth; i++) {
    group.push(i);
  }

  return update(deps, chapter.id, (current) => {
    const remaining = current.done.filter((i) => !group.includes(i));
    return { ...current, done: done ? [...remaining, ...group].sort((a, b) => a - b) : remaining };
  });
}
