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
        el("p", {}, `Picked up ${result.picked} quest event(s) from your game log since then.`),
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
})();
