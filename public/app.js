const state = {
  tasks: [],
  storylines: [],
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
    renderStorylines(state.storylines);
    populateFilters(state.tasks);
    renderTasks();
  } catch (error) {
    console.error("Failed to load dashboard data:", error);
    const line = document.getElementById("status-line");
    line.textContent = "Could not reach the local server — retrying...";
  }
}

function renderOverall(overall) {
  const percent = overall.totalTasks === 0 ? 0 : Math.round((overall.completedTasks / overall.totalTasks) * 100);
  const container = document.getElementById("overall-progress");
  container.innerHTML = `
    <h3>Overall Progress — ${overall.completedTasks}/${overall.totalTasks} (${percent}%)</h3>
    <div class="progress-bar"><div style="width: ${percent}%"></div></div>
  `;
}

function renderStatus(status) {
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
  line.textContent = parts.join(" • ");
}

function renderStorylines(storylines) {
  const container = document.getElementById("storylines");
  container.innerHTML = "";
  for (const storyline of storylines) {
    const percent =
      storyline.totalTasks === 0 ? 0 : Math.round((storyline.completedTasks / storyline.totalTasks) * 100);
    const card = document.createElement("div");
    card.className = "storyline-card";
    card.innerHTML = `
      <h3>${escapeHtml(storyline.name)} — ${storyline.completedTasks}/${storyline.totalTasks} (${percent}%)</h3>
      <div class="progress-bar"><div style="width: ${percent}%"></div></div>
    `;
    container.appendChild(card);
  }
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

  const filtered = state.tasks.filter((task) => {
    if (storylineFilter && !task.storylineIds.includes(storylineFilter)) return false;
    if (traderFilter && task.trader !== traderFilter) return false;
    if (mapFilter && task.map !== mapFilter) return false;
    if (actionableOnly && !(task.actionable && task.status !== "completed")) return false;
    return true;
  });

  const container = document.getElementById("tasks");
  container.innerHTML = "";
  for (const task of filtered) {
    const card = document.createElement("div");
    card.className = "task-card" + (task.status === "completed" ? " completed" : "");
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
    }
    container.appendChild(card);
  }
}

for (const id of ["filter-storyline", "filter-trader", "filter-map", "filter-actionable"]) {
  document.getElementById(id).addEventListener("change", renderTasks);
}

loadData();
setInterval(loadData, 15000);
