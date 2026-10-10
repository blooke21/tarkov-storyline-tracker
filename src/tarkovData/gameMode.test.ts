import { describe, it, expect } from "vitest";
import { DEFAULT_GAME_MODE, parseGameMode } from "./gameMode.js";

describe("parseGameMode", () => {
  it("defaults to pve when nothing is set", () => {
    expect(DEFAULT_GAME_MODE).toBe("pve");
    expect(parseGameMode(undefined)).toBe("pve");
  });

  it("treats an empty string like unset (an empty env var shouldn't be an error)", () => {
    expect(parseGameMode("")).toBe("pve");
  });

  it("accepts pve and regular", () => {
    expect(parseGameMode("pve")).toBe("pve");
    expect(parseGameMode("regular")).toBe("regular");
  });

  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(parseGameMode(" PvE ")).toBe("pve");
    expect(parseGameMode("REGULAR")).toBe("regular");
  });

  it("throws a clear error for anything else rather than silently falling back", () => {
    expect(() => parseGameMode("pvp")).toThrow(/TARKOV_GAME_MODE.*"pve".*"regular".*"pvp"/);
  });
});
