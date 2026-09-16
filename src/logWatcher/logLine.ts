export interface ParsedLogLine {
  date: string;
  time: string;
  version: string | null;
  level: string;
  logType: string;
  message: string;
}

// Verified against this project's own real EFT log files across three
// game versions (Nov 2025 - Sep 2026): "date time|version|level|logType|message".
// A small number of real lines (1,841 across two Nov 2025 sessions, builds
// 1.0.0.0.41760 and .41771) ALSO carry a timezone offset after the time
// even though they have a version field — both are handled by making the
// offset optional here, rather than routing those lines to the
// version-less legacy format below (which would mis-parse every field).
const CURRENT_FORMAT =
  /^(?<date>\d{4}-\d{2}-\d{2}) (?<time>\d{2}:\d{2}:\d{2}\.\d{3})(?: [+-]\d{2}:\d{2})?\|(?<version>\d+(?:\.\d+){2,})\|(?<level>[^|]+)\|(?<logType>[^|]+)\|(?<message>.*)$/;

// An older format without a version field at all, with a UTC offset on
// the timestamp instead: "date time tzoffset|level|logType|message".
// Documented in the-hideout/TarkovMonitor's issue #136 but never observed
// on this machine's own log history — kept as a defensive fallback only.
const LEGACY_FORMAT_WITH_TZ = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}\.\d{3}) [+-]\d{2}:\d{2}\|([^|]+)\|(.*)$/;

export function parseLogLine(rawLine: string): ParsedLogLine | null {
  const current = CURRENT_FORMAT.exec(rawLine);
  if (current?.groups) {
    const { date, time, version, level, logType, message } = current.groups;
    return { date, time, version, level, logType, message };
  }

  const legacy = LEGACY_FORMAT_WITH_TZ.exec(rawLine);
  if (legacy) {
    const [, date, time, level, rest] = legacy;
    const separatorIndex = rest.indexOf("|");
    if (separatorIndex === -1) {
      return null;
    }
    return {
      date,
      time,
      version: null,
      level,
      logType: rest.slice(0, separatorIndex),
      message: rest.slice(separatorIndex + 1),
    };
  }

  return null;
}

export function logLineTimestamp(line: ParsedLogLine): Date {
  return new Date(`${line.date}T${line.time}`);
}
