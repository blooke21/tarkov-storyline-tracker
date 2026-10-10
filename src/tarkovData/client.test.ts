import { describe, it, expect, vi } from "vitest";
import { fetchTasks, TARKOV_DEV_GRAPHQL_URL } from "./client.js";
import type { TarkovTask } from "./types.js";

const sampleTask: TarkovTask = {
  id: "1",
  name: "Debut",
  trader: { id: "t1", name: "Prapor" },
  map: null,
  wikiLink: "https://escapefromtarkov.fandom.com/wiki/Debut",
  kappaRequired: false,
  lightkeeperRequired: false,
  factionName: null,
  minPlayerLevel: 1,
  objectives: [],
  taskRequirements: [],
};

describe("fetchTasks", () => {
  it("returns the tasks array from a successful response", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { tasks: [sampleTask] } }),
    });

    const tasks = await fetchTasks(fakeFetch as unknown as typeof fetch);

    expect(tasks).toEqual([sampleTask]);
    expect(fakeFetch).toHaveBeenCalledWith(
      TARKOV_DEV_GRAPHQL_URL,
      expect.objectContaining({ method: "POST" })
    );
  });

  it("asks for the PvE task list by default and the regular one when told to", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { tasks: [sampleTask] } }),
    });

    await fetchTasks(fakeFetch as unknown as typeof fetch);
    await fetchTasks(fakeFetch as unknown as typeof fetch, "regular");

    const bodyOf = (call: number): string => (fakeFetch.mock.calls[call][1] as RequestInit).body as string;
    expect(bodyOf(0)).toContain("gameMode: pve");
    expect(bodyOf(1)).toContain("gameMode: regular");
  });

  it("gives up on a request that never answers instead of hanging startup forever", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { tasks: [sampleTask] } }),
    });

    await fetchTasks(fakeFetch as unknown as typeof fetch);

    const init = fakeFetch.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws when the HTTP response is not ok", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    await expect(fetchTasks(fakeFetch as unknown as typeof fetch)).rejects.toThrow(
      "tarkov.dev API request failed: 500 Internal Server Error"
    );
  });

  it("throws when the response contains GraphQL errors", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ errors: [{ message: "Field not found" }] }),
    });

    await expect(fetchTasks(fakeFetch as unknown as typeof fetch)).rejects.toThrow(
      "tarkov.dev API returned errors: Field not found"
    );
  });

  it("throws when the response has no data field", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await expect(fetchTasks(fakeFetch as unknown as typeof fetch)).rejects.toThrow(
      "tarkov.dev API returned no data"
    );
  });

  it("throws when the response's data field has no tasks array", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: {} }),
    });

    await expect(fetchTasks(fakeFetch as unknown as typeof fetch)).rejects.toThrow(
      "tarkov.dev API response did not include a tasks array"
    );
  });
});
