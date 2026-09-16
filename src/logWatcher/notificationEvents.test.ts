import { describe, it, expect } from "vitest";
import { extractNotificationEvents } from "./notificationEvents.js";

describe("extractNotificationEvents", () => {
  it("extracts a real quest-accepted event (message.type 10)", () => {
    const text = [
      "2025-12-24 12:34:41.858|1.0.0.1.41967|Info|push-notifications|Got notification | ChatMessageReceived",
      "{",
      '  "type": "new_message",',
      '  "eventId": "6919591299b7de4d6f0d651e",',
      '  "dialogId": "dialog-placeholder",',
      '  "message": {',
      '    "_id": "6919591201663a302e04ee6e",',
      '    "uid": "dialog-placeholder",',
      '    "type": 10,',
      '    "dt": 1763268882,',
      '    "text": "",',
      '    "templateId": "5967733e86f774602332fc84 description",',
      '    "hasRewards": false,',
      '    "maxStorageTime": 604800',
      "  }",
      "}",
    ].join("\n");

    const events = extractNotificationEvents(text);

    expect(events).toEqual([
      { kind: "task", taskId: "5967733e86f774602332fc84", status: "accepted", occurredAt: new Date(1763268882 * 1000) },
    ]);
  });

  it("extracts a real quest-completed event (message.type 12) with a multi-line rewards payload", () => {
    const text = [
      "2025-12-24 12:37:13.762|1.0.0.1.41967|Info|push-notifications|Got notification | ChatMessageReceived",
      "{",
      '  "type": "new_message",',
      '  "eventId": "691946e9bfc205db5c0eabb1",',
      '  "dialogId": "dialog-placeholder",',
      '  "message": {',
      '    "_id": "691946e9379bde1a8f0df5f249",',
      '    "uid": "dialog-placeholder",',
      '    "type": 12,',
      '    "dt": 1763264233,',
      '    "text": "",',
      '    "templateId": "61604635c725987e815b1a46 successMessageText dialog-placeholder 0",',
      '    "items": {',
      '      "stash": "691946e9379bde1a8f0df5f3",',
      '      "data": [',
      "        {",
      '          "_id": "691946e9379bde1a8f0df5f1",',
      '          "_tpl": "5449016a4bdc2d6f028b456f",',
      '          "upd": { "StackObjectsCount": 4929 },',
      '          "parentId": "691946e9379bde1a8f0df5f3",',
      '          "slotId": "main"',
      "        }",
      "      ]",
      "    },",
      '    "maxStorageTime": 172800,',
      '    "profileChangeEvents": [],',
      '    "hasRewards": true',
      "  }",
      "}",
    ].join("\n");

    const events = extractNotificationEvents(text);

    expect(events).toEqual([
      {
        kind: "task",
        taskId: "61604635c725987e815b1a46",
        status: "completed",
        occurredAt: new Date(1763264233 * 1000),
      },
    ]);
  });

  it("extracts a real quest-failed event (message.type 11)", () => {
    const text = [
      "2026-04-16 09:15:22.637|1.0.4.1.44236|Info|push-notifications|Got notification | ChatMessageReceived",
      "{",
      '  "type": "new_message",',
      '  "eventId": "69e3f46aeefd5fefdb223696",',
      '  "dialogId": "dialog-placeholder",',
      '  "message": {',
      '    "_id": "69e3f46a5c80cb83270482a8",',
      '    "uid": "dialog-placeholder",',
      '    "type": 11,',
      '    "dt": 1776546922,',
      '    "text": "quest started",',
      '    "templateId": "596a101f86f7741ddb481582 failMessageText",',
      '    "hasRewards": false,',
      '    "maxStorageTime": 604800',
      "  }",
      "}",
    ].join("\n");

    const events = extractNotificationEvents(text);

    expect(events).toEqual([
      { kind: "task", taskId: "596a101f86f7741ddb481582", status: "failed", occurredAt: new Date(1776546922 * 1000) },
    ]);
  });

  it("extracts a real raid-ended event, ignoring the always-'Free' status field", () => {
    const text = [
      "2025-11-22 15:44:56.154|1.0.0.1.41923|Info|push-notifications|Got notification | UserMatchOver",
      "{",
      '  "type": "userMatchOver",',
      '  "eventId": "69222ed80324ce18df0f0131",',
      '  "profileid": "profile-placeholder",',
      '  "status": "Free",',
      '  "location": "TarkovStreets",',
      '  "raidMode": "Online",',
      '  "mode": "deathmatch",',
      '  "shortId": null',
      "}",
    ].join("\n");

    const events = extractNotificationEvents(text);

    expect(events).toEqual([
      { kind: "raidEnded", occurredAt: new Date(2025, 10, 22, 15, 44, 56, 154), map: "TarkovStreets" },
    ]);
  });

  it("ignores non-task notification types like ChatMessageReceived flea-market messages (message.type 4)", () => {
    const text = [
      "2024-05-27 15:32:29.637|1.0.0.1.41967|Info|push-notifications|Got notification | ChatMessageReceived",
      "{",
      '  "type": "new_message",',
      '  "eventId": "6654dfd0ba3f3da279066bc6",',
      '  "message": {',
      '    "type": 4,',
      '    "templateId": "5bdabfb886f7743e152e867e 0",',
      '    "systemData": { "buyerNickname": "placeholder", "soldItem": "56deeefcd2720bc8328b4568", "itemCount": 1 }',
      "  }",
      "}",
    ].join("\n");

    expect(extractNotificationEvents(text)).toEqual([]);
  });

  it("skips a truncated JSON block without throwing", () => {
    const text = [
      "2026-01-01 00:00:00.000|1.0.0.0.1|Info|push-notifications|Got notification | ChatMessageReceived",
      "{",
      '  "type": "new_message"',
      // no closing brace — file ends mid-write, as happens when read while the game is still writing it
    ].join("\n");

    expect(() => extractNotificationEvents(text)).not.toThrow();
    expect(extractNotificationEvents(text)).toEqual([]);
  });

  it("skips malformed JSON without throwing and continues parsing subsequent lines", () => {
    const text = [
      "2026-01-01 00:00:00.000|1.0.0.0.1|Info|push-notifications|Got notification | ChatMessageReceived",
      "{ this is not valid json",
      "}",
      "2026-01-01 00:00:01.000|1.0.0.0.1|Info|push-notifications|Got notification | ChatMessageReceived",
      "{",
      '  "type": "new_message",',
      '  "message": { "type": 10, "dt": 1700000000, "templateId": "aaaaaaaaaaaaaaaaaaaaaaaa description" }',
      "}",
    ].join("\n");

    expect(extractNotificationEvents(text)).toEqual([
      {
        kind: "task",
        taskId: "aaaaaaaaaaaaaaaaaaaaaaaa",
        status: "accepted",
        occurredAt: new Date(1700000000 * 1000),
      },
    ]);
  });

  it("extracts task event with brace characters inside string values without dropping the event", () => {
    const text = [
      "2026-01-15 10:30:45.123|1.0.4.1.44236|Info|push-notifications|Got notification | ChatMessageReceived",
      "{",
      '  "type": "new_message",',
      '  "eventId": "69d4a2f1c8e9b5a3d7f2e1c0",',
      '  "dialogId": "dialog-placeholder",',
      '  "message": {',
      '    "_id": "69d4a2f1c8e9b5a3d7f2e1c1",',
      '    "uid": "dialog-placeholder",',
      '    "type": 10,',
      '    "dt": 1747689045,',
      '    "text": "Bring the item to the stash }",',
      '    "templateId": "57ffe4461d7cb07d13629916 description",',
      '    "hasRewards": false,',
      '    "maxStorageTime": 604800',
      "  }",
      "}",
    ].join("\n");

    const events = extractNotificationEvents(text);

    expect(events).toEqual([
      {
        kind: "task",
        taskId: "57ffe4461d7cb07d13629916",
        status: "accepted",
        occurredAt: new Date(1747689045 * 1000),
      },
    ]);
  });

  it("returns an empty array for text with no notification lines", () => {
    expect(extractNotificationEvents("just some unrelated log content\nnothing to see here")).toEqual([]);
  });
});
