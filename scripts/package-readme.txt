TARKOV STORYLINE TRACKER {{VERSION}}
====================================

Tracks your Escape from Tarkov quest progress automatically by reading the
game's own log files - no mods, nothing is sent anywhere. It shows your quest
lines, story chapters and prestige requirements, with step-by-step guides and
screenshots from the Escape from Tarkov wiki.

HOW TO START
------------
1. Unzip this folder anywhere (your Desktop is fine).
2. Double-click "Start Tarkov Tracker.cmd".
3. Your web browser opens with the tracker. Leave the black window open while
   you use it; close it to stop the tracker.

Run it again any time. If it is already running it just opens the page again.
You can leave it open while you play: it picks up new quests within seconds.

IF WINDOWS WARNS YOU
--------------------
Files from the internet get a "Windows protected your PC" or "Open file"
warning the first time. Click "More info" then "Run anyway" (or right-click the
zip BEFORE unzipping, choose Properties, tick "Unblock", then OK). The program
is plain, readable JavaScript running on the official Node.js.

IF IT SAYS IT CAN'T FIND YOUR GAME LOGS
---------------------------------------
The tracker looks for the Escape from Tarkov "Logs" folder using the BSG
Launcher's settings and the usual install folders. If the page says it can't
find it, it shows the exact file to create. In short: make a file named
settings.json in the "data" folder next to "Start Tarkov Tracker.cmd" containing

    { "logsDir": "D:\\Games\\Escape from Tarkov\\Logs" }

(with your own path, doubled backslashes), then close and reopen the tracker.

WHAT IT CONNECTS TO
-------------------
Only to download quest data (json.tarkov.dev) and guides/screenshots
(escapefromtarkov.fandom.com). It reads your game logs and saves its own
progress in the "data" folder. It never changes or sends your game files.

WHAT IT CAN'T SEE
-----------------
The game does not log your prestige level, player level, skills, hideout or
which story chapter step you are on, so those are things you set yourself in
the tracker. Quests (accepted, completed, failed) are tracked automatically.

Daily and weekly operational tasks: the game only records that you finished
one (not what it was, or when you accepted it), so the tracker shows a count
and a list of the ones you completed.

PVE, PVP AND PVP SEASON
-----------------------
Each mode is a separate character, so the tracker keeps a separate quest list,
progress, pins, story chapters and prestige for each. Switch with the PvE / PvP /
PvP Season buttons at the top of the page (the first time you open a mode it
downloads that mode's quest data, so give it a few seconds).

The game's quest messages don't say which mode they came from. The tracker works
it out from which game server the game was talking to at that moment. That
matched the game's own records for PvE and PvP Season; regular PvP couldn't be
checked because it needs a PvP session to compare against. If something lands in
the wrong mode, "Scan my logs" re-reads everything. (To start the tracker in a
particular mode, set the TARKOV_GAME_MODE environment variable to pve, regular or
pvp-season.)

SEARCH
------
The Search box above the quest list narrows it as you type (name, trader, map or
objective; press / to jump to it, Escape to clear). If matches are hidden because
"Accepted only" is on, it tells you how many and lets you show them.

CHOICES AND ENDINGS
-------------------
Some quests exclude each other: finishing one fails the others, and a few only
open up if you fail another. Those quests carry a "Multiple endings" badge with
the details (the "Multiple endings only" filter lists them), and the menu at the
bottom-left of the screen has an Endings tab that warns you about the ones you've
accepted or pinned. Story chapters with decisions (Falling Skies, Blue Fire, The
Ticket's four endings, and Boreas' dependence on earlier choices) are marked too.
The quest choices come from the quest data; the chapter ones are from the wiki.

FAILED QUESTS
-------------
A failed quest is shown in red, is never offered as "next up", and a quest
that needs it completed is marked Blocked.

IF PORT 4173 IS TAKEN
---------------------
The tracker uses the next free port and opens the browser there.

NEW CHARACTER?
--------------
Use "Check & reset my progress" at the top of the page.

Moving to a new version: copy the "data" folder from the old folder into the
new one to keep your progress.

Quest data and guides: tarkov.dev and the Escape from Tarkov wiki
(CC BY-SA). Not affiliated with Battlestate Games. See THIRD-PARTY-NOTICES.txt.
