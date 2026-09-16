import type { TarkovTask } from "../types.js";

/**
 * Representative tasks shaped like real tarkov.dev API responses.
 *
 * NOTE: captured by hand, not pulled live — the tarkov.dev API was
 * returning HTTP 422 ("GraphQL server unavailable") at the time this
 * fixture was written. The values below encode the *real* data domain
 * verified against tarkov.dev's own data pipeline source
 * (the-hideout/tarkov-data-manager, update-quests.mjs): every task's
 * factionName defaults to the literal string "Any" and is only
 * overwritten to "USEC" or "BEAR" for faction-locked tasks — it is
 * never null in a real response. Replace this fixture with an actual
 * captured API response once the API is reachable again.
 */
export const sampleTasks: TarkovTask[] = [
  {
    id: "sample-1",
    name: "Debut",
    trader: { id: "trader-prapor", name: "Prapor" },
    map: null,
    wikiLink: "https://escapefromtarkov.fandom.com/wiki/Debut",
    kappaRequired: true,
    lightkeeperRequired: false,
    factionName: "Any",
    minPlayerLevel: 1,
    objectives: [
      { id: "obj-1", type: "extract", description: "Successfully extract from the location", optional: false },
    ],
    taskRequirements: [],
  },
  {
    id: "sample-2",
    name: "Network Provider - Part 1",
    trader: { id: "trader-mechanic", name: "Mechanic" },
    map: null,
    wikiLink: "https://escapefromtarkov.fandom.com/wiki/Network_Provider_-_Part_1",
    kappaRequired: false,
    lightkeeperRequired: true,
    factionName: "Any",
    minPlayerLevel: 10,
    objectives: [{ id: "obj-2", type: "findItem", description: "Find a WI-FI Camera", optional: false }],
    taskRequirements: [{ status: ["complete"], task: { id: "sample-1" } }],
  },
  {
    id: "sample-3",
    name: "The Punisher - Part 1",
    trader: { id: "trader-prapor", name: "Prapor" },
    map: { id: "map-customs", name: "Customs" },
    wikiLink: "https://escapefromtarkov.fandom.com/wiki/The_Punisher_-_Part_1",
    kappaRequired: true,
    lightkeeperRequired: false,
    factionName: "USEC",
    minPlayerLevel: 15,
    objectives: [
      { id: "obj-3", type: "shoot", description: "Eliminate Scavs in the Customs location", optional: false },
    ],
    taskRequirements: [{ status: ["complete"], task: { id: "sample-1" } }],
  },
  {
    id: "sample-4",
    name: "Trust But Verify",
    trader: { id: "trader-skier", name: "Skier" },
    map: null,
    wikiLink: "https://escapefromtarkov.fandom.com/wiki/Trust_But_Verify",
    kappaRequired: false,
    lightkeeperRequired: false,
    factionName: "BEAR",
    minPlayerLevel: 15,
    objectives: [
      { id: "obj-4", type: "findItem", description: "Find a MP-133 12ga shotgun in raid", optional: false },
    ],
    taskRequirements: [{ status: ["complete"], task: { id: "sample-1" } }],
  },
];
