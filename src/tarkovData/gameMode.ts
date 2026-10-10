/**
 * Which Escape from Tarkov game mode's quest data to use. The two modes have
 * different task lists (PvE has its own progression), and the player's own
 * logs show which one they play — this project's author plays PvE, hence the
 * default.
 */
export type GameMode = "pve" | "regular";

export const DEFAULT_GAME_MODE: GameMode = "pve";

const VALID_MODES: readonly GameMode[] = ["pve", "regular"];

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
  const match = VALID_MODES.find((mode) => mode === normalized);
  if (!match) {
    throw new Error(`TARKOV_GAME_MODE must be "pve" or "regular", got "${value}"`);
  }
  return match;
}
