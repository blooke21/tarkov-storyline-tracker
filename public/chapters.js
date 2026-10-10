// Story chapters (Tour, Falling Skies, ...). The game doesn't record these in
// its logs, so the player says which chapter they're on and ticks steps off;
// the tracker shows only the step to do next. Everything from the API goes on
// the page through textContent/append (never as HTML).
(function () {
  const WRITE_HEADERS = { "X-Requested-With": "tarkov-tracker" };
  const STATUS_LABEL = { "not-started": "Not started", active: "Active", done: "Done" };
  const STATUS_ORDER = { active: 0, "not-started": 1, done: 2 };
  const HASH_PREFIX = "#chapter/";

  const grid = document.getElementById("chapters");
  const view = document.getElementById("chapter-view");
  if (!grid || !view) {
    return;
  }

  let chapters = [];
  let shownId = null;

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (key === "onclick") {
        node.addEventListener("click", value);
      } else if (key === "onchange") {
        node.addEventListener("change", value);
      } else {
        node[key] = value;
      }
    }
    node.append(...children);
    return node;
  }

  function button(label, kind, onclick) {
    return el("button", { type: "button", className: `button ${kind}`.trim(), onclick }, label);
  }

  function progressBar(done, total) {
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);
    const bar = el("div", { className: "progress-bar" }, el("div"));
    bar.firstChild.style.width = `${percent}%`;
    return bar;
  }

  function openId() {
    return location.hash.startsWith(HASH_PREFIX) ? decodeURIComponent(location.hash.slice(HASH_PREFIX.length)) : null;
  }

  async function post(path) {
    try {
      const response = await fetch(path, { method: "POST", headers: WRITE_HEADERS });
      if (!response.ok) {
        throw new Error(`${response.status}`);
      }
      chapters = (await response.json()).chapters;
      render();
    } catch (error) {
      console.error("Could not save story chapter progress:", error);
      alert("Could not save that — is the tracker still running?");
    }
  }

  function setStatus(chapter, status) {
    return post(`/api/chapters/status?chapter=${encodeURIComponent(chapter.id)}&status=${status}`);
  }

  function setStep(chapter, index, done) {
    return post(`/api/chapters/objective?chapter=${encodeURIComponent(chapter.id)}&index=${index}&done=${done ? 1 : 0}`);
  }

  function setPosition(chapter, index) {
    return post(`/api/chapters/position?chapter=${encodeURIComponent(chapter.id)}&index=${index}`);
  }

  function renderGrid() {
    const sorted = [...chapters].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
    const cards = sorted.map((chapter) => {
      const card = el(
        "button",
        {
          type: "button",
          className: `storyline-card selectable chapter-card ${chapter.status}`,
          onclick: () => {
            location.hash = HASH_PREFIX + encodeURIComponent(chapter.id);
          },
        },
        el("h3", {}, chapter.name),
        el("span", { className: `badge ${chapter.status}` }, STATUS_LABEL[chapter.status]),
        el("div", { className: "chapter-steps" }, `${chapter.doneSteps}/${chapter.totalSteps} steps`),
        progressBar(chapter.doneSteps, chapter.totalSteps)
      );
      return card;
    });
    grid.replaceChildren(
      el("h2", { className: "section-title" }, "Story chapters"),
      el(
        "p",
        { className: "hint" },
        "Pick the chapter you're on to see only what to do next. The game doesn't log story progress, so you tick steps off yourself."
      ),
      el("div", { className: "chapter-grid" }, ...cards)
    );
  }

  function stepRow(chapter, objective) {
    const classes = ["step", `depth-${objective.depth}`];
    if (objective.done) classes.push("done");
    if (objective.optional) classes.push("optional");
    if (objective.index === chapter.currentIndex) classes.push("current");
    const checkbox = el("input", {
      type: "checkbox",
      checked: objective.done,
      onchange: (event) => setStep(chapter, objective.index, event.target.checked),
    });
    const text = objective.optional ? `${objective.text} (optional)` : objective.text;
    const row = el("li", { className: classes.join(" ") }, el("label", {}, checkbox, " ", text));
    if (objective.depth === 1 && !objective.done) {
      row.append(" ", el("button", { type: "button", className: "link-button", onclick: () => setPosition(chapter, objective.index) }, "I'm up to here"));
    }
    return row;
  }

  function renderNow(chapter) {
    if (chapter.status === "done") {
      return el("div", { className: "now-box" }, el("h3", {}, "Chapter done"), el("p", {}, "You marked this chapter as finished."));
    }
    if (chapter.currentIndex === null) {
      return el(
        "div",
        { className: "now-box" },
        el("h3", {}, "Every main step is ticked off"),
        el("p", {}, "Mark the chapter done when you've finished it (some chapters end with a choice).")
      );
    }

    const current = chapter.objectives[chapter.currentIndex];
    const subSteps = [];
    for (let i = chapter.currentIndex + 1; i < chapter.objectives.length && chapter.objectives[i].depth > current.depth; i++) {
      subSteps.push(chapter.objectives[i]);
    }
    const upcoming = chapter.objectives
      .filter((o) => o.depth === 1 && !o.optional && !o.done && o.index > chapter.currentIndex)
      .slice(0, 3);

    const box = el(
      "div",
      { className: "now-box" },
      el("h3", {}, "Do this now"),
      el("p", { className: "now-step" }, current.text)
    );
    if (subSteps.length > 0) {
      box.append(
        el(
          "ul",
          { className: "now-substeps" },
          ...subSteps.map((s) => el("li", { className: s.done ? "done" : s.optional ? "optional" : "" }, s.optional ? `${s.text} (optional)` : s.text))
        )
      );
    }
    box.append(button("Done ✓ — next step", "primary", () => setStep(chapter, current.index, true)));
    if (upcoming.length > 0) {
      box.append(el("p", { className: "hint" }, "Then: " + upcoming.map((o) => o.text).join(" → ")));
    }
    return box;
  }

  function renderView(chapter) {
    const back = button("← All quests and chapters", "", () => {
      location.hash = "";
    });

    const actions = el("div", { className: "reset-actions" });
    if (chapter.status === "not-started") {
      actions.append(button("I'm on this chapter", "primary", () => setStatus(chapter, "active")));
    } else {
      if (chapter.status === "active") {
        actions.append(button("Mark chapter done", "primary", () => setStatus(chapter, "done")));
      } else {
        actions.append(button("Reopen chapter", "", () => setStatus(chapter, "active")));
      }
      actions.append(
        button("Start this chapter over", "", () => {
          if (confirm(`Forget all progress in "${chapter.name}"?`)) {
            setStatus(chapter, "not-started");
          }
        })
      );
    }

    const wiki = el("a", { href: chapter.wikiUrl, target: "_blank", rel: "noopener" }, "Open the chapter on the wiki");

    view.replaceChildren(
      back,
      el("h2", { className: "chapter-title" }, chapter.name, " ", el("span", { className: `badge ${chapter.status}` }, STATUS_LABEL[chapter.status])),
      el("p", { className: "hint" }, "How it starts: " + chapter.unlock),
      el("p", {}, wiki),
      el("p", { className: "chapter-steps" }, `${chapter.doneSteps}/${chapter.totalSteps} main steps done`),
      progressBar(chapter.doneSteps, chapter.totalSteps),
      actions,
      renderNow(chapter),
      el("h3", {}, "All steps"),
      el(
        "p",
        { className: "hint" },
        "Already further along? Click \"I'm up to here\" on the step you're on and everything before it is ticked off. " +
          "If a chapter branches (The Ticket and Boreas do), tick off or skip the steps for the path you didn't take."
      ),
      el("ul", { className: "step-list" }, ...chapter.objectives.map((o) => stepRow(chapter, o))),
      el("p", { className: "hint" }, "Steps are copied from the Escape from Tarkov wiki (CC BY-SA); the wiki page is the source of truth if the game changes.")
    );
  }

  function render() {
    renderGrid();
    const chapter = chapters.find((c) => c.id === openId());
    document.body.classList.toggle("viewing-chapter", Boolean(chapter));
    view.hidden = !chapter;
    if (chapter) {
      renderView(chapter);
      if (shownId !== chapter.id) {
        window.scrollTo({ top: 0 });
      }
    } else {
      view.replaceChildren();
    }
    shownId = chapter ? chapter.id : null;
  }

  async function load() {
    try {
      const response = await fetch("/api/chapters");
      chapters = (await response.json()).chapters;
      render();
    } catch (error) {
      console.error("Failed to load story chapters:", error);
    }
  }

  window.addEventListener("hashchange", render);
  load();
})();
