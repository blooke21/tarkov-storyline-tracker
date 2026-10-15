# Tarkov Storyline Tracker

Tracks your Escape from Tarkov quest progress automatically by reading the game's own log files, and groups it into quest lines, story chapters and prestige requirements, with step-by-step guides and screenshots from the Escape from Tarkov wiki. It runs on your computer and opens in your browser. Nothing is sent anywhere and nothing is modded: it only reads your log files.

## For players: download and double-click

1. Download `TarkovStorylineTracker-<version>-windows.zip` from the Releases page.
2. Unzip it anywhere.
3. Double-click **Start Tarkov Tracker.cmd**. Your browser opens with the tracker; leave the black window open while you use it.

The zip includes its own copy of Node.js, so nothing needs to be installed. The tracker finds your game's `Logs` folder using the BSG Launcher's settings and the usual install folders; if it can't, the page shows exactly how to point it at the right one. See `README.txt` inside the zip for details, including the Windows "protected your PC" prompt.

**What it tracks automatically:** quests you accept, complete or fail (from the game's notification log), plus a count of the daily and weekly operational tasks you finish. **What the game doesn't log**, so you set it yourself: prestige level, story-chapter steps, player level, skills, hideout, quest pins.

**Search and choices.** The quest list has a search box (name, trader, map, objective; `/` focuses it). Quests that exclude each other (finishing one fails the others, or failing one opens another route) are badged "Multiple endings", filterable, and warned about in the bottom-left menu's Endings tab for quests you've accepted or pinned; the choices come from the quest data's fail conditions. Story chapters with decisions and endings are marked from the wiki.

**PvE, PvP and PvP Season** are separate characters, so each has its own quests, progress, pins, story chapters and prestige; switch with the buttons at the top of the page. The game's quest messages carry no mode tag, so the tracker works out each message's mode from which game server (`gw-pve`, `gw-pvp`, `gw-pvp-season`) the game was talking to at that moment, read from the backend log. That was checked against the game's own mode markers for PvE and PvP Season (including mode switches inside one session); regular PvP uses the same mechanism but hasn't been verified against a real PvP session.

## For developers

```bash
npm install
npm test             # unit tests
npm run build        # compile TypeScript to dist/
npm start            # run it (opens your browser)
npm run shortcut     # put a Desktop shortcut to launch.cmd (needs Node installed)
npm run package      # build release/TarkovStorylineTracker-<version>-windows.zip
node scripts/build-story-data.mjs   # refresh story chapter data from the wiki
```

Settings (environment variables): `TARKOV_GAME_MODE` (`pve`, `regular` or `pvp-season`; starts the tracker in that mode, otherwise it opens in the mode you last used), `TARKOV_LOGS_DIR` (the game's `Logs` folder), `TARKOV_DATA_DIR` (where progress and downloaded data are kept; defaults to the project folder), `TARKOV_PORT` (default 4173; if it's taken and you didn't set one, the next free port is used), `TARKOV_NO_OPEN=1` (don't open the browser).

Node 22, TypeScript, SQLite via `better-sqlite3`, no web framework. See `docs/superpowers/` for the design notes.

## Data sources and credits

Quest data comes from [tarkov.dev](https://tarkov.dev). Chapter and quest guides and screenshots come from the [Escape from Tarkov wiki](https://escapefromtarkov.fandom.com) (text under CC BY-SA; screenshots are linked from the wiki, not copied). Not affiliated with Battlestate Games.
