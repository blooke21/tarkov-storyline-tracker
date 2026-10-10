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

NEW CHARACTER?
--------------
Use "Check & reset my progress" at the top of the page.

Moving to a new version: copy the "data" folder from the old folder into the
new one to keep your progress.

Quest data and guides: tarkov.dev and the Escape from Tarkov wiki
(CC BY-SA). Not affiliated with Battlestate Games. See THIRD-PARTY-NOTICES.txt.
