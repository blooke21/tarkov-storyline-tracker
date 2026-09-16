import { parseLogLine, logLineTimestamp, type ParsedLogLine } from "./logLine.js";

export type NotificationEvent =
  | { kind: "task"; taskId: string; status: "accepted" | "failed" | "completed"; occurredAt: Date }
  | { kind: "raidEnded"; occurredAt: Date; map: string | null };

const TASK_STATUS_BY_TYPE: Record<number, "accepted" | "failed" | "completed"> = {
  10: "accepted",
  11: "failed",
  12: "completed",
};

export function extractNotificationEvents(fileText: string): NotificationEvent[] {
  const lines = fileText.split(/\r?\n/);
  const events: NotificationEvent[] = [];

  for (let i = 0; i < lines.length; i++) {
    const parsed = parseLogLine(lines[i]);
    if (!parsed) {
      continue;
    }

    if (parsed.message.includes("Got notification | ChatMessageReceived")) {
      const { json, nextIndex } = readJsonBlock(lines, i + 1);
      i = nextIndex;
      if (json) {
        const event = parseTaskEvent(json, parsed);
        if (event) {
          events.push(event);
        }
      }
      continue;
    }

    if (parsed.message.includes("Got notification | UserMatchOver")) {
      const { json, nextIndex } = readJsonBlock(lines, i + 1);
      i = nextIndex;
      if (json) {
        events.push({
          kind: "raidEnded",
          occurredAt: logLineTimestamp(parsed),
          map: typeof json.location === "string" ? json.location : null,
        });
      }
      continue;
    }
  }

  return events;
}

function readJsonBlock(lines: string[], startIndex: number): { json: any; nextIndex: number } {
  if (lines[startIndex]?.trim() !== "{") {
    return { json: null, nextIndex: startIndex - 1 };
  }

  let braceCount = 0;
  let endIndex = -1;
  for (let i = startIndex; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    for (const char of trimmed) {
      if (char === "{") braceCount++;
      if (char === "}") braceCount--;
    }
    if (braceCount === 0 && i >= startIndex) {
      endIndex = i;
      break;
    }
  }
  if (endIndex === -1) {
    return { json: null, nextIndex: lines.length - 1 };
  }

  const blockText = lines.slice(startIndex, endIndex + 1).join("\n");
  try {
    return { json: JSON.parse(blockText), nextIndex: endIndex };
  } catch {
    return { json: null, nextIndex: endIndex };
  }
}

function parseTaskEvent(json: any, headerLine: ParsedLogLine): NotificationEvent | null {
  const message = json?.message;
  if (!message || typeof message.type !== "number") {
    return null;
  }
  const status = TASK_STATUS_BY_TYPE[message.type];
  if (!status) {
    return null;
  }
  const templateId = typeof message.templateId === "string" ? message.templateId : "";
  const taskId = templateId.split(" ")[0];
  if (!taskId) {
    return null;
  }
  const occurredAt = typeof message.dt === "number" ? new Date(message.dt * 1000) : logLineTimestamp(headerLine);
  return { kind: "task", taskId, status, occurredAt };
}
