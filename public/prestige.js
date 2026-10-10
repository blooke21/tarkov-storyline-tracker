// Prestige: which level you're on and what the next one needs. The game
// doesn't log prestige, your level, skills or hideout, so you say which level
// you're on and tick off requirements yourself. The one exception is "complete
// this quest", which is worked out from your quest progress. Everything from
// the API goes on the page through textContent/append (never as HTML).
(function () {
  const WRITE_HEADERS = { "X-Requested-With": "tarkov-tracker" };
  const container = document.getElementById("prestige");
  if (!container) {
    return;
  }

  let state = null;

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (key === "onchange") {
        node.addEventListener("change", value);
      } else {
        node[key] = value;
      }
    }
    node.append(...children);
    return node;
  }

  async function post(path) {
    try {
      const response = await fetch(path, { method: "POST", headers: WRITE_HEADERS });
      if (!response.ok) {
        throw new Error(`${response.status}`);
      }
      state = await response.json();
      render();
    } catch (error) {
      console.error("Could not save prestige progress:", error);
      alert("Could not save that — is the tracker still running?");
      render();
    }
  }

  function levelPicker() {
    const select = el("select", { id: "prestige-level" });
    for (let level = 0; level <= state.maxLevel; level++) {
      const option = el("option", { value: String(level) }, level === 0 ? "Prestige 0 (not prestiged yet)" : `Prestige ${level}`);
      option.selected = level === state.current;
      select.append(option);
    }
    select.addEventListener("change", () => post(`/api/prestige/level?level=${encodeURIComponent(select.value)}`));
    return el("label", {}, "I'm currently at ", select);
  }

  function conditionRow(condition) {
    const checkbox = el("input", {
      type: "checkbox",
      checked: condition.done,
      disabled: condition.automatic,
      onchange: (event) =>
        post(`/api/prestige/requirement?requirement=${encodeURIComponent(condition.id)}&done=${event.target.checked ? 1 : 0}`),
    });
    const label = el("label", {}, checkbox, " ", condition.text);
    if (condition.automatic) {
      label.append(" ", el("span", { className: "badge" }, `tracked from ${condition.source || "your progress"}`));
    }
    return el("li", { className: "step" + (condition.done ? " done" : "") }, label);
  }

  function render() {
    const nodes = [];
    if (!state || !state.available) {
      nodes.push(
        el(
          "p",
          { className: "hint" },
          "Couldn't load the prestige requirements (the quest data site may be unreachable). Restart the tracker while online to try again."
        )
      );
    } else {
      nodes.push(
        el(
          "p",
          { className: "hint" },
          "The game doesn't record your prestige level, player level, skills or hideout, so tell the tracker which level you're on and tick requirements off yourself."
        ),
        levelPicker()
      );

      if (state.next) {
        const { level, conditions, doneCount, total } = state.next;
        const percent = total === 0 ? 0 : Math.round((doneCount / total) * 100);
        const bar = el("div", { className: "progress-bar" }, el("div"));
        bar.firstChild.style.width = `${percent}%`;
        nodes.push(
          el("h3", {}, `To reach Prestige ${level}`),
          el("p", { className: "chapter-steps" }, `${doneCount}/${total} requirements done`),
          bar,
          el("ul", { className: "step-list" }, ...conditions.map(conditionRow))
        );
        if (doneCount === total) {
          nodes.push(el("p", {}, `✓ You meet every requirement for Prestige ${level}. Once you've prestiged in the game, set your level above.`));
        }
      } else {
        nodes.push(el("p", {}, "You're at the highest prestige level."));
      }
      nodes.push(
        el(
          "p",
          { className: "hint" },
          "Rewards and details: ",
          el("a", { href: state.wikiUrl, target: "_blank", rel: "noopener" }, "the wiki's Prestige page")
        )
      );
    }
    container.replaceChildren(collapsibleSection("prestige", "Prestige", ...nodes));
  }

  async function load() {
    try {
      const response = await fetch("/api/prestige");
      state = await response.json();
      // Don't redraw under the player's cursor (it would close an open dropdown).
      if (!container.contains(document.activeElement)) {
        render();
      }
    } catch (error) {
      console.error("Failed to load prestige:", error);
    }
  }

  // Quest progress can change which requirements are met, so refresh with the rest of the page.
  load();
  setInterval(load, 15000);
})();
