import { logLineTimestamp, parseLogLine } from "./logLine.js";
import type { GameMode } from "../tarkovData/gameMode.js";

/**
 * Which game mode a quest message belongs to. The messages themselves carry no mode tag, but the game talks to a
 * different server for each mode, and its backend log records every request with its time:
 *
 *   gw-pve*        PvE
 *   gw-pvp*        regular PvP
 *   gw-pvp-season* seasonal PvP
 *
 * Verified against this project's own logs: the modes worked out this way matched the push-notification log's own
 * mode markers to within about five seconds (August 2026, including PvE <-> PvP Season switches inside one session).
 *
 * Only requests the game makes to the server of the mode being played count. At startup every session also asks the
 * regular-PvP server which mode it is in (/client/game/mode); that says nothing about the mode being played.
 */
const MODE_BY_GATEWAY: Array<[RegExp, GameMode]> = [
  [/^gw-pvp-season(?:-\d+)?$/, "pvp-season"],
  [/^gw-pvp(?:-\d+)?$/, "regular"],
  [/^gw-pve(?:-\d+)?$/, "pve"],
];

// Requests made while actually playing in a mode (not the startup mode lookup).
const GAMEPLAY_REQUEST =
  /Request HTTPS[^:]*: URL: https:\/\/(gw-[a-z0-9-]+)\.escapefromtarkov\.com\/client\/(?:game\/start|game\/keepalive|game\/profile\/items\/moving|trading\/api\/getTraderAssort|mail\/dialog\/view|match\/[a-z/]+|profile\/status)\b/;

export interface ModeMarker {
  at: Date;
  mode: GameMode;
}

/** Every gameplay request in a backend log, as "at this time the game was talking to this mode's server". */
export function extractModeMarkers(backendLogText: string): ModeMarker[] {
  const markers: ModeMarker[] = [];
  for (const line of backendLogText.split(/\r?\n/)) {
    if (!line.includes("Request HTTPS")) {
      continue;
    }
    const request = GAMEPLAY_REQUEST.exec(line);
    if (!request) {
      continue;
    }
    const mode = MODE_BY_GATEWAY.find(([pattern]) => pattern.test(request[1]))?.[1];
    const parsed = parseLogLine(line);
    if (mode && parsed) {
      markers.push({ at: logLineTimestamp(parsed), mode });
    }
  }
  return markers;
}

/**
 * The mode at a moment: the mode of the last gameplay request at or before it. Before the first request (a message
 * that arrives as the game starts up) it is the first request's mode; with no requests at all it is `fallback`.
 */
export function modeAt(markers: ModeMarker[], time: Date, fallback: GameMode): GameMode {
  if (markers.length === 0) {
    return fallback;
  }
  const t = time.getTime();
  let found: ModeMarker | undefined;
  for (const marker of markers) {
    if (marker.at.getTime() <= t) {
      found = marker;
    } else {
      break;
    }
  }
  return (found ?? markers[0]).mode;
}
