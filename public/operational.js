// Operational (daily and weekly) tasks. The quest data doesn't list them and the
// game only logs that one was finished, so this is a count and a short list.
// Everything from the API goes on the page through textContent/append.
(function () {
  const container = document.getElementById("operational");
  if (!container) {
    return;
  }

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      node[key] = value;
    }
    node.append(...children);
    return node;
  }

  function when(iso) {
    return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function tile(label, value) {
    return el("div", { className: "stat-tile" }, el("strong", {}, String(value)), el("span", {}, label));
  }

  function render(data) {
    const { completed, failedSinceReset, recent } = data;
    const nodes = [
      el(
        "p",
        { className: "hint" },
        "Daily and weekly operational tasks aren't in the quest list, and the game only records that you finished one, not what it was or when you accepted it. This is what your logs show."
      ),
      el("div", { className: "stat-row" }, tile("completed today", completed.today), tile("in the last 7 days", completed.lastWeek), tile("since your reset", completed.sinceReset)),
    ];
    if (failedSinceReset > 0) {
      nodes.push(el("p", { className: "hint" }, `${failedSinceReset} failed since your reset.`));
    }
    if (recent.length === 0) {
      nodes.push(el("p", { className: "hint" }, "No operational tasks completed since your reset yet."));
    } else {
      nodes.push(
        el(
          "ul",
          { className: "operational-list" },
          ...recent.map((entry) =>
            el(
              "li",
              { className: entry.status === "failed" ? "failed" : "" },
              `${when(entry.at)} — ${entry.status === "failed" ? "failed" : "completed"}`,
              entry.trader ? ` (${entry.trader})` : ""
            )
          )
        )
      );
    }
    container.replaceChildren(collapsibleSection("operational", "Operational tasks (dailies & weeklies)", ...nodes));
  }

  async function load() {
    try {
      const response = await fetch("/api/operational");
      if (response.ok) {
        render(await response.json());
      }
    } catch (error) {
      console.error("Failed to load operational tasks:", error);
    }
  }

  load();
  setInterval(load, 60000);
})();
