/**
 * The Escape from Tarkov game modes the tracker knows about. Each has its own quest list and its own
 * character, and the game talks to a different server for each:
 *
 *   pve        -> gw-pve        (PvE; this project's author plays it, hence the default)
 *   regular    -> gw-pvp        (the normal PvP game)
 *   pvp-season -> gw-pvp-season (the seasonal PvP game)
 *
 * The quest data feed at json.tarkov.dev has a folder for each, named exactly like these ids.
 */
export type GameMode = "pve" | "regular" | "pvp-season";

export const GAME_MODES: readonly GameMode[] = ["pve", "regular", "pvp-season"];

export const DEFAULT_GAME_MODE: GameMode = "pve";

/** What the player calls each mode. */
export const GAME_MODE_LABELS: Record<GameMode, string> = {
  pve: "PvE",
  regular: "PvP",
  "pvp-season": "PvP Season",
};

export function isGameMode(value: unknown): value is GameMode {
  return typeof value === "string" && (GAME_MODES as readonly string[]).includes(value);
}

/**
 * Parses the TARKOV_GAME_MODE environment variable. Unset or empty means the
 * default; anything unrecognized is an error rather than a silent fallback,
 * because quietly showing the wrong mode's quests would look like the app
 * working while being wrong.
 */
export function parseGameMode(value: string | undefined): GameMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return DEFAULT_GAME_MODE;
  }
  if (!isGameMode(normalized)) {
    throw new Error(`TARKOV_GAME_MODE must be "pve", "regular" or "pvp-season", got "${value}"`);
  }
  return normalized;
}
