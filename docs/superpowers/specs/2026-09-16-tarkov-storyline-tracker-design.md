# Tarkov Storyline Tracker — Design

> **Update 2026-10-10 — data source.** This document and the plans were
> written assuming tarkov.dev's GraphQL API (`api.tarkov.dev/graphql`) as
> the quest-data source. That API has been returning "GraphQL server
> unavailable" since about 2026-07-21 (before this project started), so
> the app now reads tarkov.dev's static JSON feed first
> (`json.tarkov.dev/{pve,regular}/…`, `src/tarkovData/jsonClient.ts`) and
> keeps GraphQL only as a fallback. Everything downstream of the
> `TarkovTask` shape is unchanged. Quest data is per game mode — PvE by
> default, `TARKOV_GAME_MODE=regular` to switch — and the cache records
> which mode it holds.
>
> **Known gap found the same day:** progress is accumulated from the
> player's entire log history, which spans wipes, so it overstates the
> current character's progress (see the project memory / follow-up work).

## Problem

Escape from Tarkov's quest system is a large dependency graph spanning
the main story, faction-specific chains, side objectives, and special
unlock lines (Lightkeeper, Collector). Every existing community tool
(TarkovTracker, TarkovBuddy, Tarkov Advisor) presents this as one flat
checklist of "quests remaining," and requires the player to manually
mark quests complete. TarkovMonitor automates the marking (by reading
the game's own log files) but still presents a flat list, not the
underlying storyline structure.

No existing tool shows a player *which storylines* they're
progressing through, how far along each one is, or what to do next
within each — while also tracking their progress automatically.

## Goals

- Automatically detect quest progress by reading the game's local log
  files — no manual checkbox-clicking, no separate account to
  maintain in sync.
- Group quests into named storylines (Kappa path, Lightkeeper path,
  main story, faction lines) derived from the quest dependency graph,
  not a hand-maintained list.
- For each quest, show plain-language objectives inline, plus a link
  to the wiki page for anything deeper (lore, screenshots, tips).
- Work fully offline after first sync; nothing leaves the user's
  machine.

## Non-goals (v1)

- Squad/shared progress (multiple players, cloud sync) — a plausible
  v2, but out of scope now.
- Cross-device access (phone, another PC) — local-only for v1.
- Mac/Linux support — the game is Windows-only, so is this.
- Editorial wiki content mirrored into the app — we link out to the
  wiki instead of scraping/republishing it (see Decisions below).

## Decisions already made

- **No cloud backend.** Everything runs locally: a small background
  service plus a browser-based dashboard served from `localhost`.
  Rationale: no hosting cost, no accounts, no privacy exposure, and a
  squad-sharing v2 can be added later without having over-built this
  version.
- **Quest content comes from tarkov.dev's GraphQL API, not the wiki.**
  The API's `Task` type already exposes `objectives` (structured,
  plain-language steps), `wikiLink`, `kappaRequired`, and
  `lightkeeperRequired` fields, sourced from the game's own data. We
  render `objectives` inline and use `wikiLink` as a "view on wiki"
  link for anything not covered. We do not scrape or mirror wiki page
  content: it would duplicate data we already have more reliable
  access to, and would inherit CC BY-SA attribution/share-alike
  obligations and template-driven markup that changes without notice.
- **Storylines are derived, not hand-curated.** `kappaRequired` and
  `lightkeeperRequired` seed two storylines directly. Others (main
  story, faction branches) are derived by tracing connected chains
  through `taskRequirements` (each task's prerequisite tasks). This
  keeps storylines correct across wipes/patches automatically, as
  long as tarkov.dev's data is current.
- **Log-based tracking is modeled on TarkovMonitor's approach**
  (same log directory/technique, actively maintained by the same org
  that runs tarkov.dev). We're not depending on an unproven technique.

## Architecture

One local application with two logical halves that ship together:

```
┌─────────────────────────────────────────────────────────┐
│  Local App (single install, runs in system tray)         │
│                                                           │
│  ┌────────────────┐   events   ┌──────────────────────┐ │
│  │  Log Watcher    │───────────▶│  Local Progress Store │ │
│  │  (tails EFT     │            │  (SQLite/JSON file)   │ │
│  │  log files)     │            └──────────┬───────────┘ │
│  └────────────────┘                        │             │
│                                             │ read        │
│  ┌────────────────┐   cached    ┌──────────▼───────────┐ │
│  │ tarkov.dev Sync │───────────▶│  Local HTTP Server    │ │
│  │ (task graph,    │  data      │  (serves API +        │ │
│  │ periodic pull)  │            │  dashboard UI)        │ │
│  └────────────────┘            └──────────┬───────────┘ │
└─────────────────────────────────────────────┼───────────┘
                                               │ localhost
                                        ┌──────▼───────┐
                                        │   Browser     │
                                        │  Dashboard    │
                                        └───────────────┘
```

### Components

1. **Log Watcher** — tails EFT's log files for quest accept/complete/
   fail events, level-ups, and raid start/end. Runs continuously
   while installed. Includes a **backfill mode**: on first run (or on
   demand), re-scans historical log files so a player who already has
   partial progress doesn't start from zero.

2. **Tarkov Data Sync** — pulls the task graph from tarkov.dev's
   GraphQL API (`id`, `name`, `objectives`, `wikiLink`,
   `taskRequirements`, `kappaRequired`, `lightkeeperRequired`,
   `trader`, `map`, `minPlayerLevel`) and caches it to local disk.
   Refreshes on an interval (this data changes only around patches/
   wipes) — never blocks the dashboard if the network is unavailable.

3. **Storyline Deriver** — pure logic over the cached task graph:
   groups tasks into named storylines by (a) the `kappaRequired` /
   `lightkeeperRequired` flags, and (b) tracing connected chains
   through `taskRequirements`. Runs after each data sync; output is
   just data the dashboard reads, not a separate service.

4. **Local Progress Store** — durable record of which tasks the
   watcher has observed as accepted/completed/failed, plus metadata
   (last raid seen, last sync time). SQLite file on disk.

5. **Local HTTP Server** — serves a small JSON API (progress +
   storyline data) and the static dashboard assets on `localhost`.
   Keeps the watcher, data sync, and web UI as one shippable process
   rather than three separate things to install.

6. **Dashboard (browser UI)** — shows overall progress, one section
   per storyline with its own progress bar, a "next up" list (tasks
   whose prerequisites are already met but aren't done), and a quest
   card per task: objectives inline, trader, map, and a wiki link.
   Filterable by trader, map, and storyline.

### Data flow

Game writes logs → Watcher tails and parses → events land in the
Local Progress Store → Local HTTP Server reads the store plus the
cached task graph → Dashboard renders it in the browser. The only
network calls are the periodic tarkov.dev sync; everything else is
local disk and localhost traffic.

## Error handling

- **Log format changes** (BSG updates the client): parser skips
  unrecognized lines rather than crashing, and logs a warning to a
  local diagnostics file. The dashboard shows a "last event seen at
  <time>" indicator so staleness is visible instead of silently wrong.
- **tarkov.dev unreachable**: fall back to the last successfully
  cached task graph; the app keeps working offline. Dashboard shows
  "task data last updated <date>."
- **Ambiguous/ out-of-order log events** (e.g. a quest completion
  seen without a prior accept, from before the watcher was running):
  treated as "mark complete" without requiring the accept event first
  — backfill mode exists precisely to catch these.

## Testing

- **Log parser**: unit tests against a fixture set of real
  (anonymized) log excerpts covering accept, turn-in, fail, and
  raid-boundary lines, including at least one fixture per known past
  log-format variant if available.
- **Storyline deriver**: snapshot tests against the current
  tarkov.dev task graph for known chains (Lightkeeper's line
  starting at "Network Provider," Collector/Kappa) so a schema or
  data shape change is caught by a failing test, not a silently
  wrong grouping in the UI.
- **Local HTTP API**: integration tests that seed the progress store
  and cached task graph, then assert the API responses match expected
  storyline/progress shapes.
- **Manual verification**: run against a real EFT install with actual
  play to confirm end-to-end detection before calling v1 done.

## Open risks

- BSG could change the log format at any time with no notice; this is
  the single biggest risk to the automatic-tracking premise. Mitigated
  by soft-fail parsing and a visible staleness indicator, not eliminated.
- tarkov.dev is itself a community-run project; if it goes down
  long-term (as tarkov-tools did before it), the data sync layer would
  need a new source. Caching mitigates short outages, not a permanent
  shutdown.
