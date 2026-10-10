import type { JsonFeed } from "../jsonClient.js";
import { TARKOV_DEV_GRAPHQL_URL } from "../client.js";
import type { TarkovTask } from "../types.js";
import { jsonFeedSample } from "./jsonFeedSample.js";

export interface FakeFeedFetchOptions {
  /** Feed the JSON endpoints serve. Defaults to the real captured sample. */
  feed?: JsonFeed;
  /** If set, every JSON-feed request fails with this HTTP status. */
  jsonStatus?: number;
  /** If set, GraphQL requests succeed with these tasks; otherwise they fail with a 422, like the real outage. */
  graphqlTasks?: TarkovTask[];
}

export interface FakeFeedFetch {
  fetchImpl: typeof fetch;
  /** Every URL requested, in order. */
  calls: string[];
  /** Request bodies sent to the GraphQL endpoint, in order. */
  graphqlBodies: string[];
  /** How many times the JSON feed's `tasks` file was requested — i.e. how many JSON syncs happened. */
  jsonSyncCount(): number;
  graphqlRequestCount(): number;
}

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  } as unknown as Response;
}

/**
 * A fake `fetch` that routes by URL like the real services do, so tests
 * exercise the actual request paths rather than counting calls to a mock.
 */
export function createFakeFeedFetch(options: FakeFeedFetchOptions = {}): FakeFeedFetch {
  const feed = options.feed ?? jsonFeedSample;
  const calls: string[] = [];
  const graphqlBodies: string[] = [];

  const jsonFiles: Record<string, unknown> = {
    tasks: { tasks: feed.tasks },
    tasks_en: feed.tasksEn,
    traders_en: feed.tradersEn,
    maps_en: feed.mapsEn,
  };

  const impl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push(url);

    if (url === TARKOV_DEV_GRAPHQL_URL) {
      graphqlBodies.push(String(init?.body ?? ""));
      if (options.graphqlTasks) {
        return response(200, { data: { tasks: options.graphqlTasks } });
      }
      return response(422, { errors: ["GraphQL server unavailable. Try again later."] });
    }

    if (options.jsonStatus !== undefined && options.jsonStatus !== 200) {
      return response(options.jsonStatus, {});
    }

    const fileName = url.split("/").pop() ?? "";
    if (fileName in jsonFiles) {
      return response(200, { data: jsonFiles[fileName] });
    }
    return response(404, { error: "Not found" });
  };

  return {
    fetchImpl: impl as unknown as typeof fetch,
    calls,
    graphqlBodies,
    jsonSyncCount: () => calls.filter((url) => url.endsWith("/tasks")).length,
    graphqlRequestCount: () => calls.filter((url) => url === TARKOV_DEV_GRAPHQL_URL).length,
  };
}
