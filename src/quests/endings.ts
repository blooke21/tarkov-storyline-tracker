import type { TaskStatus } from "../progress/store.js";
import type { TarkovTask } from "../tarkovData/types.js";

/** Another quest involved in a choice, with where the player stands with it. */
export interface EndingLink {
  taskId: string;
  name: string;
  status: TaskStatus | null;
}

/**
 * The choices a quest involves. In Tarkov some quests exclude each other: finishing one fails the others, and a few
 * quests only open up if you fail another. The quest data lists these as "fail conditions" and requirements.
 */
export interface QuestEndings {
  /** Finishing this quest fails these (they can't be done afterwards). */
  failedByCompleting: EndingLink[];
  /** Finishing any of these fails this quest. */
  failsIfCompleted: EndingLink[];
  /** Quests that only open up if this one is failed: the other way the story can go. */
  unlocksIfFailed: EndingLink[];
  /** One of the quests this would fail is needed for the Kappa container. */
  blocksKappa: boolean;
}

const has = (statuses: string[], status: string): boolean => statuses.includes(status);

/** "Big Customer", "Out of Curiosity (accepted)": quest names, noting where the player already stands with one. */
function nameList(links: EndingLink[], joiner: string): string {
  const named = links.map((link) => {
    if (link.status === "accepted") return `${link.name} (you've accepted it)`;
    if (link.status === "failed") return `${link.name} (already failed)`;
    if (link.status === "completed") return `${link.name} (already done)`;
    return link.name;
  });
  return named.length <= 1 ? (named[0] ?? "") : `${named.slice(0, -1).join(", ")} ${joiner} ${named.at(-1)}`;
}

/**
 * What a quest's choices mean for the player, in a few plain sentences. Before the quest is decided they look
 * ahead ("completing it fails..."); once it's completed or failed they say what happened.
 */
export function describeEndings(endings: QuestEndings, ownStatus: TaskStatus | null = null): string[] {
  if (ownStatus === "failed" || ownStatus === "completed") {
    const lines: string[] = [];
    const cause = endings.failsIfCompleted.filter((link) => link.status === "completed");
    if (ownStatus === "failed" && cause.length > 0) {
      lines.push(`Failed because you completed ${cause.map((link) => link.name).join(" and ")}.`);
    }
    if (ownStatus === "completed" && endings.failedByCompleting.length > 0) {
      lines.push(`Completing it failed ${endings.failedByCompleting.map((link) => link.name).join(" and ")}.`);
    }
    if (ownStatus === "failed" && endings.unlocksIfFailed.length > 0) {
      lines.push(`Failing it opened up ${endings.unlocksIfFailed.map((link) => link.name).join(" and ")}.`);
    }
    return lines;
  }
  const lines: string[] = [];
  if (endings.failedByCompleting.length > 0) {
    lines.push(`Completing this quest fails ${nameList(endings.failedByCompleting, "and")}.`);
  }
  if (endings.failsIfCompleted.length > 0) {
    lines.push(`Completing ${nameList(endings.failsIfCompleted, "or")} fails this quest.`);
  }
  if (endings.unlocksIfFailed.length > 0) {
    lines.push(`If you fail this quest, ${nameList(endings.unlocksIfFailed, "and")} opens up instead.`);
  }
  if (endings.blocksKappa) {
    lines.push("One of the quests it would fail is needed for the Kappa container.");
  }
  return lines;
}

/**
 * Every quest that takes part in a choice, with who it excludes and what it unlocks. Quests with no alternatives
 * aren't in the result. Statuses are the player's current ones, so a warning can say "already failed".
 */
export function computeEndings(tasks: TarkovTask[], statuses: Map<string, TaskStatus>): Map<string, QuestEndings> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const link = (taskId: string): EndingLink | null => {
    const task = byId.get(taskId);
    return task ? { taskId, name: task.name, status: statuses.get(taskId) ?? null } : null;
  };
  const endings = new Map<string, QuestEndings>();
  const entry = (taskId: string): QuestEndings => {
    let existing = endings.get(taskId);
    if (!existing) {
      existing = { failedByCompleting: [], failsIfCompleted: [], unlocksIfFailed: [], blocksKappa: false };
      endings.set(taskId, existing);
    }
    return existing;
  };
  const push = (list: EndingLink[], item: EndingLink | null): void => {
    if (item && !list.some((existing) => existing.taskId === item.taskId)) {
      list.push(item);
    }
  };

  for (const task of tasks) {
    // "<task> fails when <other> is complete": other finishing is a way this ends, and this quest is lost by it.
    for (const condition of task.failIfTasks ?? []) {
      if (condition.taskId === task.id || !has(condition.status, "complete") || !byId.has(condition.taskId)) {
        continue;
      }
      push(entry(task.id).failsIfCompleted, link(condition.taskId));
      push(entry(condition.taskId).failedByCompleting, link(task.id));
    }
    // "<task> needs <other> to have been failed": failing it is a different route through the story.
    for (const requirement of task.taskRequirements) {
      if (has(requirement.status, "failed") && !has(requirement.status, "complete") && requirement.task.id !== task.id && byId.has(requirement.task.id)) {
        push(entry(requirement.task.id).unlocksIfFailed, link(task.id));
      }
    }
  }

  for (const [taskId, item] of endings) {
    item.blocksKappa = item.failedByCompleting.some((other) => byId.get(other.taskId)?.kappaRequired === true);
    // An entry that ended up with nothing (can't happen today) isn't a choice.
    if (item.failedByCompleting.length + item.failsIfCompleted.length + item.unlocksIfFailed.length === 0) {
      endings.delete(taskId);
    }
  }
  return endings;
}
