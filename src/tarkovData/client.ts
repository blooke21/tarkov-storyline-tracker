import type { TarkovTask } from "./types.js";

export const TARKOV_DEV_GRAPHQL_URL = "https://api.tarkov.dev/graphql";

const TASKS_QUERY = `
  query GetTasks {
    tasks(lang: en) {
      id
      name
      wikiLink
      kappaRequired
      lightkeeperRequired
      factionName
      minPlayerLevel
      trader { id name }
      objectives { id type description optional }
      taskRequirements { status task { id } }
    }
  }
`;

interface GraphQLResponse {
  data?: { tasks: TarkovTask[] };
  errors?: Array<{ message: string }>;
}

export async function fetchTasks(fetchImpl: typeof fetch = fetch): Promise<TarkovTask[]> {
  const response = await fetchImpl(TARKOV_DEV_GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: TASKS_QUERY }),
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

  return body.data.tasks;
}
