// The "Numbers look wrong? Check & reset my progress" flow:
//   1. pick when the new character started,
//   2. double-check exactly what will change,
//   3. confirm, wipe, refresh.
// Everything shown comes from the local API and is put on the page with
// textContent/append (never as HTML), so quest names can't inject markup.
(function () {
  // Sent on the one state-changing request. A page on another website can't
  // add a custom header to a cross-origin request without the browser first
  // asking this server for permission (which it never grants), so this keeps
  // other sites from triggering a wipe through your browser.
  const WRITE_HEADERS = { "X-Requested-With": "tarkov-tracker" };
  const NOW = "now";

  const panel = document.getElementById("reset-panel");
  const openButton = document.getElementById("open-reset");
  const scanButton = document.getElementById("open-scan");
  if (!panel || !openButton) {
    return;
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

  function button(label, kind, onclick, disabled) {
    return el("button", { type: "button", className: `button ${kind}`.trim(), onclick, disabled: Boolean(disabled) }, label);
  }

  function when(iso) {
    return new Date(iso).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function show(...nodes) {
    panel.replaceChildren(...nodes);
    panel.hidden = false;
    panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function close() {
    panel.hidden = true;
    panel.replaceChildren();
  }

  async function request(path, options) {
    const response = await fetch(path, options);
    let body = null;
    try {
      body = await response.json();
    } catch {
      // fall through to the status-based message below
    }
    if (!response.ok) {
      throw new Error((body && body.error) || `The tracker answered with an error (${response.status}).`);
    }
    return body;
  }

  function showError(message) {
    show(
      el("h3", {}, "Something went wrong"),
      el("p", { className: "error" }, message),
      el("div", { className: "reset-actions" }, button("Close", "", close))
    );
  }

  async function open() {
    show(el("p", { className: "hint" }, "Looking at your recent quest activity…"));
    try {
      renderPick(await request("/api/wipe/options"));
    } catch (error) {
      showError(error.message);
    }
  }

  // Step 1 — when did the new character start?
  function renderPick(options) {
    const current = options.current;
    const radios = [];

    function addOption(value, text, tag) {
      const input = el("input", { type: "radio", name: "reset-since", value });
      radios.push(input);
      const label = el("label", {}, input, el("span", {}, text));
      if (tag) {
        label.append(el("span", { className: "tag" }, tag));
      }
      return label;
    }

    const list = el("div", { className: "reset-options" });
    list.append(addOption(NOW, "Start fresh from right now"));
    for (const event of options.recentEvents) {
      list.append(
        addOption(event.at, `${when(event.at)} — ${event.status} ${event.name}`, event.at === options.suggestedSince ? "suggested" : "")
      );
    }

    const preselect = radios.find((radio) => radio.value === (options.suggestedSince || NOW));
    (preselect || radios[0]).checked = true;

    const intro = [
      el(
        "p",
        {},
        `Right now the tracker is counting ${current.completed} completed and ${current.accepted} accepted quests` +
          (current.failed ? ` (and ${current.failed} failed).` : ".")
      ),
    ];
    if (options.progressSince) {
      intro.push(el("p", { className: "hint" }, `Tracking was last reset to ${when(options.progressSince)}.`));
    }

    const next = button("Next: double-check", "primary", () => {
      const chosen = radios.find((radio) => radio.checked);
      preview(chosen ? chosen.value : NOW);
    });

    show(
      el("h3", {}, "Reset progress for a new character"),
      ...intro,
      el(
        "p",
        {},
        "When did your new character start? Pick the first thing you did as the new character — " +
          "everything logged before that moment will be ignored."
      ),
      options.recentEvents.length
        ? el("p", { className: "hint" }, "These are your most recent quest actions, newest first:")
        : el("p", { className: "hint" }, "No quest activity found in your game logs yet, so starting from now is the only choice."),
      list,
      el("div", { className: "reset-actions" }, next, button("Cancel", "", close))
    );
  }

  // Step 2 — show exactly what would happen, change nothing yet.
  async function preview(choice) {
    const since = choice === NOW ? new Date().toISOString() : choice;
    show(el("p", { className: "hint" }, "Checking what that would change…"));
    try {
      renderConfirm(since, await request(`/api/wipe/preview?since=${encodeURIComponent(since)}`));
    } catch (error) {
      showError(error.message);
    }
  }

  function renderConfirm(since, result) {
    const clear = result.willClear;
    const kept = result.willTrack;

    const afterwards = kept.length
      ? [
          el("p", {}, `After the wipe, these ${kept.length} quest(s) from your game log since then will be counted:`),
          el("ul", {}, ...kept.map((quest) => el("li", {}, `${quest.name} — ${quest.status}`))),
        ]
      : [
          el(
            "p",
            {},
            "Nothing in your game log falls after that moment, so you'll start from zero. " +
              "Quests will show up here as you accept and finish them."
          ),
        ];

    const confirm = button("Wipe and start fresh", "danger", () => wipe(since, confirm));

    show(
      el("h3", {}, "Double-check before wiping"),
      el("p", {}, `Tracking will restart from ${when(since)}.`),
      el("p", {}, `This clears what the tracker is counting now: ${clear.completed} completed, ${clear.accepted} accepted, ${clear.failed} failed.`),
      ...afterwards,
      el(
        "p",
        { className: "note" },
        "This only changes the tracker's own saved progress. It doesn't touch your game or your log files."
      ),
      el(
        "div",
        { className: "reset-actions" },
        confirm,
        button("Back", "", open),
        button("Cancel", "", close)
      )
    );
  }

  // Step 3 — do it, then refresh the dashboard.
  async function wipe(since, confirmButton) {
    confirmButton.disabled = true;
    confirmButton.textContent = "Wiping…";
    try {
      const result = await request(`/api/wipe?since=${encodeURIComponent(since)}`, {
        method: "POST",
        headers: WRITE_HEADERS,
      });
      show(
        el("h3", {}, "Done — starting fresh"),
        el("p", {}, `Tracking now starts from ${when(result.since)}.`),
        ...scanSummary(result.scan),
        el("div", { className: "reset-actions" }, button("Close", "primary", close))
      );
      if (typeof loadData === "function") {
        loadData();
      }
    } catch (error) {
      showError(error.message);
    }
  }

  // What a log scan found, as page elements. Used after a wipe and by "Scan my logs".
  function scanSummary(scan) {
    const nodes = [
      el(
        "p",
        {},
        `Scanned ${scan.logFolders} game log folder(s) (${scan.foldersWithQuestLog} had quest logs): ` +
          `${scan.eventsInLogs} quest event(s) in total` +
          (scan.progressSince ? `, ${scan.eventsCounted} of them since your reset.` : ".")
      ),
      el(
        "p",
        {},
        `The tracker now has ${scan.tracked.completed} completed, ${scan.tracked.accepted} accepted` +
          (scan.tracked.failed ? `, ${scan.tracked.failed} failed.` : ".")
      ),
    ];

    if (scan.added + scan.changed === 0) {
      nodes.push(el("p", {}, "✓ Everything in your logs was already in the tracker — nothing was missing."));
    } else {
      nodes.push(
        el("p", {}, `Fixed ${scan.added + scan.changed} quest(s): ${scan.added} added, ${scan.changed} updated.`),
        el(
          "ul",
          {},
          ...scan.changes.map((change) => el("li", {}, `${change.name} — ${change.from ? change.from + " → " : ""}${change.to}`))
        )
      );
      if (scan.added + scan.changed > scan.changes.length) {
        nodes.push(el("p", { className: "hint" }, `…and ${scan.added + scan.changed - scan.changes.length} more.`));
      }
    }

    if (scan.keptFromEarlier > 0) {
      nodes.push(
        el(
          "p",
          { className: "hint" },
          `${scan.keptFromEarlier} quest(s) the tracker remembers aren't in your current logs (the game deletes old logs). They were kept.`
        )
      );
    }
    if (scan.notInQuestList > 0) {
      nodes.push(
        el(
          "p",
          { className: "hint" },
          `${scan.notInQuestList} quest(s) in your logs aren't in the quest list (operational tasks and the like), so they're counted but not shown.`
        )
      );
    }
    if (scan.missingEarlierTotal > 0) {
      nodes.push(
        el(
          "p",
          {},
          `Worth a look: ${scan.missingEarlierTotal} quest(s) you've started need an earlier quest that your logs don't show you completing. ` +
            "If you did finish them, the logs may be incomplete:"
        ),
        el("ul", {}, ...scan.missingEarlier.map((item) => el("li", {}, `${item.name} (needed for ${item.neededBy})`)))
      );
    }
    if (scan.lastEventAt) {
      nodes.push(
        el(
          "p",
          { className: "note" },
          `Newest quest event in your logs: ${when(scan.lastEventAt)}. A finished quest only shows up once you hand it in to the trader.`
        )
      );
    }
    return nodes;
  }

  async function scan() {
    show(el("p", { className: "hint" }, "Reading every game log…"));
    try {
      const report = await request("/api/scan", { method: "POST", headers: WRITE_HEADERS });
      show(
        el("h3", {}, "Log scan complete"),
        ...scanSummary(report),
        el("div", { className: "reset-actions" }, button("Close", "primary", close))
      );
      if (typeof loadData === "function") {
        loadData();
      }
    } catch (error) {
      showError(error.message);
    }
  }

  openButton.addEventListener("click", open);
  if (scanButton) {
    scanButton.addEventListener("click", scan);
  }
})();
