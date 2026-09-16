import { parseLogLine, logLineTimestamp } from "./logLine.js";

export interface RaidStartEvent {
  occurredAt: Date;
  map: string | null;
  raidId: string | null;
  mode: string | null;
}

const PROFILE_STATUS_PATTERN = /Location:\s*([^,]+).*?shortId:\s*([A-Za-z0-9]+)/;
const RAID_MODE_PATTERN = /RaidMode:\s*([^,]+)/;

export function extractRaidStartEvents(fileText: string): RaidStartEvent[] {
  const lines = fileText.split(/\r?\n/);
  const events: RaidStartEvent[] = [];
  let pending: { map: string | null; raidId: string | null; mode: string | null } | null = null;

  for (const rawLine of lines) {
    const parsed = parseLogLine(rawLine);
    if (!parsed) {
      continue;
    }

    if (parsed.message.includes("TRACE-NetworkGameCreate profileStatus:")) {
      const locationMatch = PROFILE_STATUS_PATTERN.exec(parsed.message);
      const modeMatch = RAID_MODE_PATTERN.exec(parsed.message);
      pending = {
        map: locationMatch ? locationMatch[1].trim() : null,
        raidId: locationMatch ? locationMatch[2].trim() : null,
        mode: modeMatch ? modeMatch[1].trim() : null,
      };
      continue;
    }

    if (parsed.message.includes("GameStarted:") && pending) {
      events.push({ ...pending, occurredAt: logLineTimestamp(parsed) });
      pending = null;
    }
  }

  return events;
}
