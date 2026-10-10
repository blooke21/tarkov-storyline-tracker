import { DEFAULT_GAME_MODE, type GameMode } from "./gameMode.js";
import type { TarkovTask } from "./types.js";

// tarkov.dev's GraphQL API. As of 2026-10 it has been returning "GraphQL
// server unavailable" since about 2026-07-21, so the JSON feed in
// jsonClient.ts is tried first and this is the fallback for if/when GraphQL
// comes back. The query shape was verified against the API's schema source,
// not against a live response — it hasn't been reachable to test against.
export const TARKOV_DEV_GRAPHQL_URL = "https://api.tarkov.dev/graphql";

const REQUEST_TIMEOUT_MS = 30_000;

function tasksQuery(gameMode: GameMode): string {
  // gameMode is a GraphQL enum (unquoted) and is a closed union type, so it
  // can't carry anything but "pve" or "regular" into the query text.
  return `
  query GetTasks {
    tasks(lang: en, gameMode: ${gameMode}) {
      id
      name
      wikiLink
      kappaRequired
      lightkeeperRequired
      factionName
      minPlayerLevel
      trader { id name }
      map { id name }
      objectives { id type description optional }
      taskRequirements { status task { id } }
    }
  }
`;
}

interface GraphQLResponse {
  data?: { tasks: TarkovTask[] };
  errors?: Array<{ message: string }>;
}

export async function fetchTasks(
  fetchImpl: typeof fetch = fetch,
  gameMode: GameMode = DEFAULT_GAME_MODE
): Promise<TarkovTask[]> {
  const response = await fetchImpl(TARKOV_DEV_GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: tasksQuery(gameMode) }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`tarkov.dev API request failed: ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as GraphQLResponse;

  if (body.errors && body.errors.length > 0) {
    throw new Error(`tarkov.dev API returned errors: ${body.errors.map((e) => e.message).join("; ")}`);
  }

  if (!body.data) {
    throw new Error("tarkov.dev API returned no data");
  }

  if (!Array.isArray(body.data.tasks)) {
    throw new Error("tarkov.dev API response did not include a tasks array");
  }

  return body.data.tasks;
}
