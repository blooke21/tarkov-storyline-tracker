const state = {
  tasks: [],
  storylines: [],
  moreLinesOpen: false,
  pendingQuest: null,
  // Wiki walkthroughs for quests: opened ones, and what has been fetched (a guide, or "loading" / "error").
  openGuides: new Set(),
  questGuides: {},
};

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function isSafeHttpUrl(value) {
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function loadData() {
  try {
    const [statusRes, progressRes, tasksRes] = await Promise.all([
      fetch("/api/status"),
      fetch("/api/progress"),
      fetch("/api/tasks"),
    ]);
    const status = await statusRes.json();
    const progress = await progressRes.json();
    const tasksData = await tasksRes.json();

    state.storylines = progress.storylines;
    state.tasks = tasksData.tasks;

    renderStatus(status);
    renderOverall(progress.overall);
    populateFilters(state.tasks);
    renderPinned();
    renderStorylines(state.storylines);
    renderFocus();
    renderTasks();
    if (state.pendingQuest) {
      const id = state.pendingQuest;
      state.pendingQuest = null;
      showQuest(id);
    }
  } catch (error) {
    console.error("Failed to load dashboard data:", error);
    const line = document.getElementById("status-line");
    line.textContent = "Could not reach the local server — retrying...";
  }
}

// Jump to one quest in the list: clear every filter that could hide it, scroll
// to it and flash it. Used by links elsewhere on the page (e.g. prestige).
function showQuest(taskId) {
  if (state.tasks.length === 0) {
    state.pendingQuest = taskId; // the list isn't loaded yet; loadData finishes the job
    return;
  }
  for (const id of ["filter-storyline", "filter-trader", "filter-map"]) {
    document.getElementById(id).value = "";
  }
  document.getElementById("filter-actionable").checked = false;
  document.getElementById("filter-hide-completed").checked = false;
  document.getElementById("filter-accepted").checked = false; // not remembered: it's only for this jump
  renderStorylines(state.storylines);
  renderFocus();
  renderTasks();

  const card = document.getElementById(`task-${taskId}`);
  if (!card) {
    return;
  }
  card.scrollIntoView({ block: "center" });
  card.classList.remove("flash");
  void card.offsetWidth; // restart the animation if it is flashing already
  card.classList.add("flash");
  setTimeout(() => card.classList.remove("flash"), 2600);
}

function renderOverall(overall) {
  const percent = overall.totalTasks === 0 ? 0 : Math.round((overall.completedTasks / overall.totalTasks) * 100);
  const container = document.getElementById("overall-progress");
  container.innerHTML = `
    <h3>Overall Progress — ${overall.completedTasks}/${overall.totalTasks} (${percent}%)</h3>
    <div class="progress-bar"><div style="width: ${percent}%"></div></div>
  `;
}

// If the game's logs can't be found the tracker has nothing to read, so say how to fix that.
function renderLogsWarning(logsFolder) {
  const box = document.getElementById("logs-warning");
  box.hidden = !logsFolder || logsFolder.found;
  if (box.hidden) {
    box.replaceChildren();
    return;
  }
  const where = logsFolder.source === "TARKOV_LOGS_DIR" || logsFolder.source === "settings.json" ? `at ${logsFolder.path}` : "anywhere I looked";
  box.replaceChildren(
    el("p", {}, el("strong", {}, "Couldn't find your Escape from Tarkov logs "), `${where}, so no quests can be tracked yet.`),
    el("p", { className: "hint" }, "Looked in: " + logsFolder.tried.join(" • ")),
    el(
      "p",
      {},
      "To point the tracker at the right folder, create a file named ",
      el("code", {}, logsFolder.settingsFile),
      " containing ",
      el("code", {}, `{ "logsDir": "D:\\\\Games\\\\Escape from Tarkov\\\\Logs" }`),
      " (use your own folder, with doubled backslashes), then close and reopen the tracker."
    )
  );
}

function renderStatus(status) {
  renderLogsWarning(status.logsFolder);
  const line = document.getElementById("status-line");
  const parts = [];
  parts.push(
    status.lastWatcherPollAt
      ? `Last synced: ${new Date(status.lastWatcherPollAt).toLocaleString()}`
      : "Watcher has not synced yet"
  );
  if (status.taskGraphFetchedAt) {
    parts.push(`Quest data updated: ${new Date(status.taskGraphFetchedAt).toLocaleDateString()}`);
  }
  if (status.progressSince) {
    parts.push(`Counting progress since: ${new Date(status.progressSince).toLocaleString()}`);
  }
  line.textContent = parts.join(" • ");
}

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (key === "onclick") {
      node.addEventListener("click", value);
    } else {
      node[key] = value;
    }
  }
  node.append(...children);
  return node;
}

// Sent on the one kind of request that changes saved data, so a page on some
// other site can't make your browser do it (see the note in reset.js).
const TRACKER_WRITE_HEADERS = { "X-Requested-With": "tarkov-tracker" };

// The game doesn't write its own quest pins to any log, so pins are the
// tracker's own: click Pin on a quest and it shows at the top of the page.
async function togglePin(task) {
  const pin = !task.pinned;
  try {
    const response = await fetch(`/api/pins?task=${encodeURIComponent(task.id)}&pinned=${pin ? 1 : 0}`, {
      method: "POST",
      headers: TRACKER_WRITE_HEADERS,
    });
    if (!response.ok) {
      throw new Error(`${response.status}`);
    }
    task.pinned = pin;
    renderPinned();
    renderFocus();
    renderTasks();
  } catch (error) {
    console.error("Could not save the pin:", error);
    alert("Could not save that pin — is the tracker still running?");
  }
}

// ---- quest walkthroughs from the wiki (text, items needed, screenshots) ----

async function loadQuestGuide(task) {
  if (state.questGuides[task.id]) {
    return;
  }
  state.questGuides[task.id] = "loading";
  try {
    const response = await fetch(`/api/quests/guide?task=${encodeURIComponent(task.id)}`);
    if (!response.ok) {
      throw new Error(`${response.status}`);
    }
    state.questGuides[task.id] = await response.json();
  } catch (error) {
    console.error("Could not load the quest walkthrough:", error);
    state.questGuides[task.id] = "error";
  }
  rerenderQuestViews();
}

function rerenderQuestViews() {
  renderPinned();
  renderFocus();
  renderTasks();
}

function toggleQuestGuide(task) {
  if (state.openGuides.has(task.id)) {
    state.openGuides.delete(task.id);
  } else {
    state.openGuides.add(task.id);
    if (state.questGuides[task.id] === "error") {
      delete state.questGuides[task.id]; // try again
    }
    loadQuestGuide(task);
  }
  rerenderQuestViews();
}

function questGuideButton(task) {
  const open = state.openGuides.has(task.id);
  return el(
    "button",
    {
      type: "button",
      className: "link-button",
      title: "Walkthrough, items you need and screenshots, from the wiki",
      onclick: () => toggleQuestGuide(task),
    },
    open ? "Hide how-to" : "How to do this"
  );
}

// The open walkthrough for a quest, or null if it isn't open.
function questGuideNode(task) {
  if (!state.openGuides.has(task.id)) {
    return null;
  }
  const guide = state.questGuides[task.id];
  const box = el("div", { className: "guide quest-guide" });
  if (!guide || guide === "loading") {
    box.append(el("p", { className: "hint" }, "Loading the walkthrough from the wiki…"));
    return box;
  }
  if (guide === "error") {
    box.append(el("p", { className: "hint" }, "Couldn't reach the wiki just now. Click \"Hide how-to\" and open it again to retry."));
    return box;
  }
  if (!guide.found || (guide.sections.length === 0 && guide.rewards.length === 0)) {
    box.append(el("p", { className: "hint" }, "The wiki has no walkthrough for this quest yet."));
  }
  for (const part of guide.sections) {
    box.append(el("h5", {}, part.title), ...part.blocks.map(renderGuideBlock).filter(Boolean));
  }
  if (guide.rewards.length > 0) {
    box.append(el("h5", {}, "Rewards"), el("ul", {}, ...guide.rewards.map((reward) => el("li", {}, reward))));
  }
  if (typeof guide.wikiUrl === "string" && guide.wikiUrl.startsWith("https://")) {
    box.append(
      el(
        "p",
        { className: "hint" },
        "Text and screenshots from the ",
        el("a", { href: guide.wikiUrl, target: "_blank", rel: "noopener noreferrer", referrerPolicy: "no-referrer" }, "Escape from Tarkov wiki"),
        " (CC BY-SA)."
      )
    );
  }
  return box;
}

// Adds the "How to do this" button and, when it's open, the walkthrough to a quest card.
function addQuestGuide(card, task) {
  card.append(" ", questGuideButton(task));
  const node = questGuideNode(task);
  if (node) {
    card.append(node);
  }
}

function pinButton(task) {
  return el(
    "button",
    {
      type: "button",
      className: "link-button",
      title: task.pinned ? "Remove from the pinned list at the top" : "Show this quest at the top of the page",
      onclick: () => togglePin(task),
    },
    task.pinned ? "📌 Unpin" : "📌 Pin"
  );
}

function renderPinned() {
  const panel = document.getElementById("pinned-panel");
  const pinned = state.tasks.filter((t) => t.pinned);
  const open = pinned.filter((t) => t.status !== "completed");
  const doneCount = pinned.length - open.length;
  panel.hidden = pinned.length === 0;
  if (pinned.length === 0) {
    panel.replaceChildren();
    return;
  }

  const nodes = [el("h2", { className: "section-title" }, `📌 Pinned quests (${open.length})`)];
  if (open.length === 0) {
    nodes.push(el("p", { className: "hint" }, "Everything you pinned is completed."));
  }
  for (const task of open) {
    const objectives = task.objectives.filter((o) => !o.optional).map((o) => el("li", {}, o.description));
    const card = el(
      "div",
      { className: "now-box" },
      el("h4", {}, task.name, " ", task.status ? el("span", { className: "badge" }, task.status) : ""),
      el("div", { className: "task-meta" }, `${task.trader}${task.map ? " • " + task.map : ""}`),
      el("ul", {}, ...objectives)
    );
    if (task.wikiLink && isSafeHttpUrl(task.wikiLink)) {
      card.append(el("a", { href: task.wikiLink, target: "_blank", rel: "noopener" }, "View on wiki"), " ");
    }
    card.append(pinButton(task));
    addQuestGuide(card, task);
    nodes.push(card);
  }
  if (doneCount > 0) {
    nodes.push(el("p", { className: "hint" }, `${doneCount} pinned quest(s) already completed, so hidden here.`));
  }
  panel.replaceChildren(...nodes);
}

// A section the player can fold away (Story chapters, Quest lines, Prestige).
// Whether it is open is remembered in this browser; if storage is blocked it
// simply starts open every time.
function collapsibleSection(id, title, ...children) {
  const key = `tarkovTracker.section.${id}`;
  let open = true;
  try {
    open = localStorage.getItem(key) !== "closed";
  } catch {
    // Storage unavailable: stay open.
  }
  const details = el("details", { className: "section", open }, el("summary", {}, el("h2", { className: "section-title" }, title)), ...children);
  details.addEventListener("toggle", () => {
    try {
      localStorage.setItem(key, details.open ? "open" : "closed");
    } catch {
      // Not remembered; fine.
    }
  });
  return details;
}

function percentOf(done, total) {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

function selectedStoryline() {
  return document.getElementById("filter-storyline").value;
}

function selectStoryline(id) {
  document.getElementById("filter-storyline").value = id;
  renderStorylines(state.storylines);
  renderFocus();
  renderTasks();
  if (id) {
    document.getElementById("focus-panel").scrollIntoView({ block: "start", behavior: "smooth" });
  }
}

function storylineCard(storyline, selected) {
  const percent = percentOf(storyline.completedTasks, storyline.totalTasks);
  const bar = el("div", { className: "progress-bar" }, el("div"));
  bar.firstChild.style.width = `${percent}%`;
  const title = el("h3", {}, `${storyline.name} — ${storyline.completedTasks}/${storyline.totalTasks} (${percent}%)`);
  if (storyline.inProgress) {
    title.append(" ", el("span", { className: "badge active" }, "In progress"));
  }
  return el(
    "button",
    {
      type: "button",
      className: "storyline-card selectable" + (selected ? " selected" : ""),
      title: selected ? "Click to show all quests again" : "Click to see only this quest line",
      onclick: () => selectStoryline(selected ? "" : storyline.id),
    },
    title,
    bar
  );
}

function renderStorylines(storylines) {
  const container = document.getElementById("storylines");
  const selected = selectedStoryline();
  const big = storylines.filter((s) => s.kind !== "chain");
  const chains = storylines.filter((s) => s.kind === "chain");
  const startedChains = chains.filter((s) => s.inProgress || s.id === selected);
  const otherChains = chains.filter((s) => !startedChains.includes(s));

  const nodes = [
    el("p", { className: "hint" }, "Click one to see only its quests and what to do next."),
    ...big.map((s) => storylineCard(s, s.id === selected)),
    ...startedChains.map((s) => storylineCard(s, s.id === selected)),
  ];
  if (otherChains.length > 0) {
    const details = el("details", { className: "more-lines" }, el("summary", {}, `More quest chains (${otherChains.length})`));
    details.append(el("div", { className: "chain-grid" }, ...otherChains.map((s) => storylineCard(s, false))));
    // Keep the list open across the 15-second refresh if the player opened it.
    details.open = state.moreLinesOpen;
    details.addEventListener("toggle", () => {
      state.moreLinesOpen = details.open;
    });
    nodes.push(details);
  }
  container.replaceChildren(collapsibleSection("quest-lines", "Quest lines", ...nodes));
}

function taskLine(task) {
  const line = el("li", {}, el("strong", {}, task.name), ` — ${task.trader}${task.map ? " • " + task.map : ""}`);
  if (task.wikiLink && isSafeHttpUrl(task.wikiLink)) {
    line.append(" ", el("a", { href: task.wikiLink, target: "_blank", rel: "noopener" }, "wiki"));
  }
  line.append(" ", pinButton(task));
  return line;
}

// "Working on now" for the selected quest line: the quests the player has
// accepted, with what's left to do, and what they can start next.
// "Accepted only" (on unless the player turns it off) limits the quest list to quests they have accepted.
function acceptedOnly() {
  return document.getElementById("filter-accepted").checked;
}

// Lines that are far too big to browse whole (every trader quest) get a short panel instead of the long
// "available to start" list while "Accepted only" is on: the accepted quests are the list below.
const COMPACT_LINES = new Set(["side-quests"]);

function renderFocus() {
  const panel = document.getElementById("focus-panel");
  const id = selectedStoryline();
  const storyline = state.storylines.find((s) => s.id === id);
  panel.hidden = !storyline;
  if (!storyline) {
    panel.replaceChildren();
    return;
  }

  const tasks = state.tasks.filter((t) => t.storylineIds.includes(id));
  const working = tasks.filter((t) => t.status === "accepted");

  if (COMPACT_LINES.has(id) && acceptedOnly()) {
    // The list below is the whole story here: just the accepted quests.
    panel.replaceChildren(
      el(
        "div",
        { className: "focus-head" },
        el("h2", {}, `${storyline.name} — ${working.length} accepted`),
        el("button", { type: "button", className: "button", onclick: () => selectStoryline("") }, "✕ Show all quests")
      ),
      el(
        "p",
        { className: "hint" },
        working.length === 0
          ? "You haven't accepted any side quests yet. They show up here as soon as you accept one from a trader."
          : "Only the side quests you've accepted are shown. Quests you haven't accepted yet, and finished ones, are hidden."
      )
    );
    return;
  }

  const available = tasks.filter((t) => t.actionable && t.status !== "accepted" && t.status !== "completed");
  const MAX_AVAILABLE = 8;

  const nodes = [
    el(
      "div",
      { className: "focus-head" },
      el("h2", {}, `${storyline.name} — ${storyline.completedTasks}/${storyline.totalTasks} done`),
      el("button", { type: "button", className: "button", onclick: () => selectStoryline("") }, "✕ Show all quests")
    ),
    el("h3", {}, `Working on now (${working.length})`),
  ];

  if (working.length === 0) {
    nodes.push(el("p", { className: "hint" }, "None of these quests is active right now. Pick one from Available to start below."));
  }
  for (const task of working) {
    const objectives = task.objectives.filter((o) => !o.optional).map((o) => el("li", {}, o.description));
    const card = el(
      "div",
      { className: "now-box" },
      el("h4", {}, task.name),
      el("div", { className: "task-meta" }, `${task.trader}${task.map ? " • " + task.map : ""}`),
      el("ul", {}, ...objectives)
    );
    if (task.wikiLink && isSafeHttpUrl(task.wikiLink)) {
      card.append(el("a", { href: task.wikiLink, target: "_blank", rel: "noopener" }, "View on wiki"), " ");
    }
    card.append(pinButton(task));
    addQuestGuide(card, task);
    nodes.push(card);
  }

  nodes.push(el("h3", {}, `Available to start (${available.length})`));
  if (available.length === 0) {
    nodes.push(el("p", { className: "hint" }, "Nothing new is unlocked in this line right now."));
  } else {
    nodes.push(el("ul", { className: "available-list" }, ...available.slice(0, MAX_AVAILABLE).map(taskLine)));
    if (available.length > MAX_AVAILABLE) {
      nodes.push(el("p", { className: "hint" }, `…and ${available.length - MAX_AVAILABLE} more in the list below.`));
    }
  }
  panel.replaceChildren(...nodes);
}

function populateFilters(tasks) {
  fillSelect(
    "filter-storyline",
    dedupeByValue(state.storylines.map((s) => ({ value: s.id, label: s.name })))
  );
  fillSelect(
    "filter-trader",
    dedupeByValue(tasks.map((t) => ({ value: t.trader, label: t.trader })))
  );
  fillSelect(
    "filter-map",
    dedupeByValue(tasks.filter((t) => t.map).map((t) => ({ value: t.map, label: t.map })))
  );
}

function dedupeByValue(options) {
  const seen = new Map();
  for (const option of options) {
    seen.set(option.value, option);
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function fillSelect(id, options) {
  const select = document.getElementById(id);
  const current = select.value;
  select.innerHTML = '<option value="">All</option>';
  for (const option of options) {
    const el = document.createElement("option");
    el.value = option.value;
    el.textContent = option.label;
    select.appendChild(el);
  }
  select.value = current;
}

function renderTasks() {
  const storylineFilter = document.getElementById("filter-storyline").value;
  const traderFilter = document.getElementById("filter-trader").value;
  const mapFilter = document.getElementById("filter-map").value;
  const actionableOnly = document.getElementById("filter-actionable").checked;
  const hideCompleted = document.getElementById("filter-hide-completed").checked;

  const filtered = state.tasks.filter((task) => {
    if (storylineFilter && !task.storylineIds.includes(storylineFilter)) return false;
    if (acceptedOnly() && task.status !== "accepted") return false;
    if (traderFilter && task.trader !== traderFilter) return false;
    if (mapFilter && task.map !== mapFilter) return false;
    if (actionableOnly && !(task.actionable && task.status !== "completed")) return false;
    if (hideCompleted && task.status === "completed") return false;
    return true;
  });

  const container = document.getElementById("tasks");
  container.innerHTML = "";
  if (filtered.length === 0 && acceptedOnly()) {
    container.append(
      el(
        "p",
        { className: "hint" },
        "No quests you've accepted match these filters. Untick \"Accepted only\" to see quests you haven't accepted yet."
      )
    );
  }
  for (const task of filtered) {
    const card = document.createElement("div");
    card.className = "task-card" + (task.status === "completed" ? " completed" : "");
    card.id = `task-${task.id}`;
    const badges = [];
    if (task.actionable && task.status !== "completed") {
      badges.push('<span class="badge actionable">Next up</span>');
    }
    if (task.status) {
      badges.push(`<span class="badge">${escapeHtml(task.status)}</span>`);
    }
    const objectives = task.objectives
      .map((o) => `<li>${escapeHtml(o.description)}${o.optional ? " (optional)" : ""}</li>`)
      .join("");
    card.innerHTML = `
      <h4>${escapeHtml(task.name)}</h4>
      <div class="task-meta">${badges.join(" ")} ${escapeHtml(task.trader)}${task.map ? " • " + escapeHtml(task.map) : ""}</div>
      <ul>${objectives}</ul>
    `;
    if (task.wikiLink && isSafeHttpUrl(task.wikiLink)) {
      const link = document.createElement("a");
      link.href = task.wikiLink;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "View on wiki";
      card.appendChild(link);
      card.append(" ");
    }
    card.append(pinButton(task));
    addQuestGuide(card, task);
    container.appendChild(card);
  }
}

for (const id of ["filter-trader", "filter-map", "filter-actionable", "filter-hide-completed"]) {
  document.getElementById(id).addEventListener("change", renderTasks);
}

// "Accepted only" is on by default and the player's choice is remembered in this browser.
const ACCEPTED_ONLY_KEY = "tarkovTracker.acceptedOnly";
try {
  if (localStorage.getItem(ACCEPTED_ONLY_KEY) === "off") {
    document.getElementById("filter-accepted").checked = false;
  }
} catch {
  // Storage unavailable: stays on.
}
document.getElementById("filter-accepted").addEventListener("change", (event) => {
  try {
    localStorage.setItem(ACCEPTED_ONLY_KEY, event.target.checked ? "on" : "off");
  } catch {
    // Not remembered; fine.
  }
  renderFocus();
  renderTasks();
});
// Choosing a quest line from the dropdown does the same as clicking its card.
document.getElementById("filter-storyline").addEventListener("change", (event) => selectStoryline(event.target.value));

loadData();
setInterval(loadData, 15000);
