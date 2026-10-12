import type { ProgressStore } from "../progress/store.js";
import type { BringRequirement, TarkovTask } from "../tarkovData/types.js";
import type { QuestGuide } from "../wiki/questGuide.js";
import { readPins } from "./pinsApi.js";

export interface BringApiDeps {
  store: ProgressStore;
  getTasks: () => TarkovTask[];
  /** The wiki's walkthrough for a quest (from its saved copy if there is one). Optional: without it only the quest data is used. */
  getQuestGuide?: (taskId: string) => Promise<QuestGuide | null>;
}

export interface BringItemView {
  text: string;
  /** Extra detail from the wiki ("Unlocks the director's office..."), if it has any. */
  note: string | null;
}

export interface BringQuestView {
  taskId: string;
  name: string;
  items: BringItemView[];
}

export interface BringResponse {
  quests: BringQuestView[];
}

const norm = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, "");

function describeItem(requirement: BringRequirement): string {
  const what = requirement.names.join(" or ");
  const amount = requirement.count > 1 ? `${requirement.count}× ` : "";
  if (requirement.kind === "weapon") return `Use weapon: ${amount}${what}`;
  if (requirement.kind === "gear") return `Wear: ${what}`;
  return `${amount}${what}`;
}

/** The same thing needed by several objectives is listed once: markers and items add up, a key is only needed once. */
function combine(requirements: BringRequirement[]): BringRequirement[] {
  const combined = new Map<string, BringRequirement>();
  for (const requirement of requirements) {
    const key = `${requirement.kind}|${requirement.names.join("|")}`;
    const existing = combined.get(key);
    if (!existing) {
      combined.set(key, { ...requirement });
    } else if (requirement.kind === "key" || requirement.kind === "weapon" || requirement.kind === "gear") {
      existing.count = Math.max(existing.count, requirement.count);
    } else {
      existing.count += requirement.count;
    }
  }
  return [...combined.values()];
}

/** Rows the wiki marks as "Required" in a quest's items table: what to have on you, with its note. */
function wikiRequiredItems(guide: QuestGuide): Array<{ name: string; amount: number; note: string | null }> {
  const rows = guide.sections.flatMap((section) => section.blocks).flatMap((block) => (block.kind === "items" ? block.items : []));
  return rows.flatMap((row) => {
    const [requirement, ...details] = row.note.split("; ");
    if (!/^required/i.test(requirement ?? "")) {
      return [];
    }
    const amount = Number.parseInt(row.amount.replace(/[^0-9]/g, ""), 10);
    return [{ name: row.name, amount: Number.isFinite(amount) && amount > 0 ? amount : 1, note: details.filter(Boolean).join("; ") || null }];
  });
}

/**
 * What to take into a raid for each pinned quest that isn't finished: from the
 * quest data (markers, items to plant, keys...), plus anything the wiki's
 * "Required" items table adds, such as a signal pistol the data doesn't list.
 */
export async function buildBringResponse(deps: BringApiDeps): Promise<BringResponse> {
  const tasks = new Map(deps.getTasks().map((task) => [task.id, task]));
  const statuses = deps.store.getAllStatuses();
  const quests: BringQuestView[] = [];

  for (const taskId of readPins(deps.store)) {
    const task = tasks.get(taskId);
    if (!task || statuses.get(taskId) === "completed") {
      continue;
    }
    const required = combine(task.objectives.filter((o) => !o.optional).flatMap((o) => o.bring ?? []));
    const items: Array<BringItemView & { names: string[] }> = required.map((requirement) => ({
      text: describeItem(requirement),
      note: null,
      names: requirement.names,
    }));

    let guide: QuestGuide | null = null;
    try {
      guide = (await deps.getQuestGuide?.(taskId)) ?? null;
    } catch {
      // The wiki can't be reached and nothing is saved: the quest data alone has to do.
    }
    for (const row of guide ? wikiRequiredItems(guide) : []) {
      const match = items.find((item) => item.names.some((name) => norm(name) === norm(row.name)));
      if (match) {
        match.note ??= row.note;
      } else {
        items.push({ text: `${row.amount > 1 ? `${row.amount}× ` : ""}${row.name}`, note: row.note, names: [row.name] });
      }
    }

    if (items.length > 0) {
      quests.push({ taskId, name: task.name, items: items.map(({ text, note }) => ({ text, note })) });
    }
  }
  return { quests };
}
