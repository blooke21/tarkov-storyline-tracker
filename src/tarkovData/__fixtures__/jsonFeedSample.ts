import type { JsonFeed } from "../jsonClient.js";

/**
 * REAL data, captured 2026-10-10 from the live tarkov.dev JSON feed
 * (https://json.tarkov.dev/pve/{tasks,tasks_en,traders_en,maps_en}) and
 * trimmed to 6 representative tasks: one with a map, one with
 * requirements plus an optional objective, one Kappa-required, one BEAR-only,
 * one USEC-only, and one with no map. The only edits are removing bulky
 * fields this app never reads (objective zone geometry, rewards, key lists)
 * and keeping just the translation entries those tasks reference — values
 * and structure are otherwise exactly as served, including the quirks the
 * converter has to handle (names are translation keys, trader/map/
 * requirement references are bare ids).
 */
export const jsonFeedSample: JsonFeed = {
  "tasks": {
    "657315ddab5a49b71f098853": {
      "id": "657315ddab5a49b71f098853",
      "name": "657315ddab5a49b71f098853 name",
      "trader": "54cb57776803fa99248b456e",
      "wikiLink": "https://escapefromtarkov.fandom.com/wiki/First_in_Line",
      "minPlayerLevel": 1,
      "taskRequirements": [],
      "traderRequirements": [],
      "objectives": [
        {
          "id": "65732ac3c67dcd96adffa3c7",
          "description": "65732ac3c67dcd96adffa3c7",
          "type": "visit",
          "optional": false,
          "maps": [
            "653e6760052c01c1c805532f",
            "65b8d6f5cdde2479cb2a3125"
          ]
        },
        {
          "id": "65817bf31404f3565aef9fec",
          "description": "65817bf31404f3565aef9fec",
          "type": "giveItem",
          "count": 3,
          "optional": false,
          "items": [
            "590c695186f7741e566b64a2",
            "5751a89d24597722aa0e8db0",
            "5af0548586f7743a532b7e99",
            "544fb3f34bdc2d03748b456a",
            "544fb37f4bdc2dee738b4567",
            "5755383e24597772cb798966",
            "590c657e86f77412b013051d",
            "60098ad7c2240c0fe85c570a",
            "590c661e86f7741e566b646a",
            "590c678286f77426c9660122",
            "5755356824597772cb798962",
            "544fb45d4bdc2dee738b4568",
            "544fb25a4bdc2dfb738b4567",
            "5751a25924597722c463c472",
            "5d02778e86f774203e7dedbe",
            "5af0454c86f7746bf20992e8",
            "60098af40accd37ef2175f27",
            "5e831507ea0a7c419c2f9bd9",
            "5e8488fa988a8701445df1e4",
            "544fb3364bdc2d34748b456a",
            "5d02797c86f774203f38e30a",
            "5ed515c8d380ab312177c0fa",
            "5ed515f6915ec335206e4152",
            "5c10c8fd86f7743d7d706df3",
            "5ed515e03a40a50460332579",
            "5ed51652f6c34d2cc26336a1",
            "5ed5160a87bb8443d10680b5",
            "5ed5166ad380ab312177c100",
            "637b60c3b7afa97bfc3d7001",
            "5ed515ece452db0eb56fc028",
            "637b6179104668754b72f8f5",
            "637b6251104668754b72f8f9",
            "5c0e530286f7747fa1419862",
            "637b612fb7afa97bfc3d7005",
            "5c0e531286f7747fa54205c2",
            "5c0e531d86f7747fa23f4d42",
            "5fca13ca637ee0341a484f46",
            "637b620db7afa97bfc3d7009",
            "5c0e533786f7747fa23f4d47",
            "5c0e534186f7747fa1419867",
            "5fca138c2a7b221b2852a5c6",
            "5c052e6986f7746b207bc3c9",
            "5c0530ee86f774697952d952",
            "6389c6c7dbfd5e4b95197e68",
            "5b4335ba86f7744d2837a264",
            "5af0534a86f7743b6f354284",
            "59e361e886f774176c10a2a5",
            "59e3606886f77417674759a5",
            "5d1b3a5d86f774252167ba22",
            "5d1b3f2d86f774253763b735",
            "62a0a043cf4a99369e2624a5",
            "619cc01e0a7c3a1a2731940c"
          ],
          "dogTagLevel": 0,
          "maxDurability": 100,
          "minDurability": 0,
          "foundInRaid": true
        }
      ],
      "restartable": false,
      "experience": 3000,
      "factionName": "Any",
      "availableDelaySecondsMin": 0,
      "availableDelaySecondsMax": 0,
      "normalizedName": "first-in-line",
      "kappaRequired": false,
      "lightkeeperRequired": false,
      "taskImageLink": "https://assets.tarkov.dev/657315ddab5a49b71f098853.webp",
      "map": "653e6760052c01c1c805532f"
    },
    "6834233fecd5cf3a440d855b": {
      "id": "6834233fecd5cf3a440d855b",
      "name": "6834233fecd5cf3a440d855b name",
      "trader": "579dc571d53a0658a154fbec",
      "wikiLink": "https://escapefromtarkov.fandom.com/wiki/Against_the_Conscience_-_Part_1",
      "minPlayerLevel": 10,
      "taskRequirements": [
        {
          "task": "68341c4babec72d95d0c1260",
          "status": [
            "complete"
          ]
        },
        {
          "task": "697878057aa1273126030fb0",
          "status": [
            "complete"
          ]
        }
      ],
      "traderRequirements": [],
      "objectives": [
        {
          "id": "6834233fecd5cf3a440d855f",
          "description": "6834233fecd5cf3a440d855f",
          "type": "visit",
          "optional": false,
          "requiredKeys": [
            [
              "664d4b0103ef2c61246afb56"
            ]
          ],
          "maps": [
            "56f40101d2720b2a4d8b45d6"
          ]
        },
        {
          "id": "6834233fecd5cf3a440d8567",
          "description": "6834233fecd5cf3a440d8567",
          "type": "findItem",
          "count": 1,
          "optional": true,
          "items": [
            "664d4b0103ef2c61246afb56"
          ],
          "dogTagLevel": 0,
          "maxDurability": 100,
          "minDurability": 0,
          "foundInRaid": false,
          "maps": []
        },
        {
          "id": "6834233fecd5cf3a440d8561",
          "description": "6834233fecd5cf3a440d8561",
          "type": "visit",
          "optional": false,
          "requiredKeys": [
            [
              "664d4b0103ef2c61246afb56"
            ]
          ],
          "maps": [
            "56f40101d2720b2a4d8b45d6"
          ]
        },
        {
          "id": "6834233fecd5cf3a440d8564",
          "description": "6834233fecd5cf3a440d8564",
          "type": "extract",
          "count": 1,
          "optional": false,
          "exitStatus": [
            "ExpBonusRunner",
            "ExpBonusSurvived"
          ],
          "maps": [
            "56f40101d2720b2a4d8b45d6"
          ]
        }
      ],
      "restartable": false,
      "experience": 11700,
      "factionName": "Any",
      "availableDelaySecondsMin": 0,
      "availableDelaySecondsMax": 0,
      "normalizedName": "against-the-conscience-part-1-pve-zone",
      "kappaRequired": false,
      "lightkeeperRequired": false,
      "taskImageLink": "https://assets.tarkov.dev/6834233fecd5cf3a440d855b.webp",
      "map": "56f40101d2720b2a4d8b45d6"
    },
    "597a0e5786f77426d66c0636": {
      "id": "597a0e5786f77426d66c0636",
      "name": "597a0e5786f77426d66c0636 name",
      "trader": "58330581ace78e27b8b10cee",
      "wikiLink": "https://escapefromtarkov.fandom.com/wiki/Chemical_-_Part_3",
      "minPlayerLevel": 9,
      "taskRequirements": [
        {
          "task": "597a0b2986f77426d66c0633",
          "status": [
            "complete"
          ]
        }
      ],
      "traderRequirements": [
        {
          "id": "6a706162b88b18e3bf23198a",
          "requirementType": "level",
          "compareMethod": ">=",
          "value": 2,
          "trader": "5c0647fdd443bc2504c2d371"
        }
      ],
      "objectives": [
        {
          "id": "597a15b386f774799e5cd152",
          "description": "597a15b386f774799e5cd152",
          "type": "findQuestItem",
          "count": 1,
          "optional": false,
          "possibleLocations": [
            {
              "map": "55f2d3fd4bdc2d5f408b4567",
              "positions": [
                {
                  "x": 26.326584,
                  "y": 8.978607,
                  "z": 36.763622
                },
                {
                  "x": 25.56231,
                  "y": 8.0731945,
                  "z": 38.48874
                },
                {
                  "x": 23.249971,
                  "y": 8.535252,
                  "z": 39.403866
                }
              ]
            },
            {
              "map": "59fc81d786f774390775787e",
              "positions": [
                {
                  "x": 26.326584,
                  "y": 8.978607,
                  "z": 36.763622
                },
                {
                  "x": 23.249971,
                  "y": 8.535252,
                  "z": 39.403866
                },
                {
                  "x": 25.56231,
                  "y": 8.0731945,
                  "z": 38.48874
                }
              ]
            }
          ],
          "maps": [
            "55f2d3fd4bdc2d5f408b4567",
            "59fc81d786f774390775787e"
          ],
          "questItem": "593a87af86f774122f54a951"
        },
        {
          "id": "597a15c386f77405ba6887d2",
          "description": "597a15c386f77405ba6887d2",
          "type": "giveQuestItem",
          "count": 1,
          "optional": false,
          "maps": [],
          "questItem": "593a87af86f774122f54a951"
        }
      ],
      "restartable": false,
      "experience": 10000,
      "factionName": "Any",
      "availableDelaySecondsMin": 0,
      "availableDelaySecondsMax": 0,
      "normalizedName": "chemical-part-3",
      "kappaRequired": true,
      "lightkeeperRequired": false,
      "taskImageLink": "https://assets.tarkov.dev/597a0e5786f77426d66c0636.webp",
      "map": "55f2d3fd4bdc2d5f408b4567"
    },
    "6613f3007f6666d56807c929": {
      "id": "6613f3007f6666d56807c929",
      "name": "6613f3007f6666d56807c929 name",
      "trader": "5ac3b934156ae10c4430e83c",
      "wikiLink": "https://escapefromtarkov.fandom.com/wiki/Drip-Out_-_Part_1",
      "minPlayerLevel": 27,
      "taskRequirements": [],
      "traderRequirements": [
        {
          "id": "6a5a4640ca416f4b9e1f8fd8",
          "requirementType": "level",
          "compareMethod": ">=",
          "value": 3,
          "trader": "5ac3b934156ae10c4430e83c"
        }
      ],
      "objectives": [
        {
          "id": "6613f36ca4dc044e13e02295",
          "description": "6613f36ca4dc044e13e02295",
          "type": "shoot",
          "count": 100,
          "optional": false,
          "shotType": "kill",
          "bodyParts": [],
          "usingWeapon": [],
          "usingWeaponMods": [],
          "distance": {
            "value": 0,
            "compareMethod": ">="
          },
          "timeFromHour": 0,
          "timeUntilHour": 0,
          "wearing": [],
          "notWearing": [],
          "enemyHealthEffect": null,
          "targetNames": [
            "PmcBot"
          ],
          "playerHealthEffect": null,
          "maps": [
            "5b0fc42d86f7744a585f9105",
            "6a294a5b5eb5f9a1700417b7",
            "5704e5fad2720bc05b8b4567"
          ]
        },
        {
          "id": "6616819ac7c53d7769413d9c",
          "description": "6616819ac7c53d7769413d9c",
          "type": "giveItem",
          "count": 50,
          "optional": false,
          "items": [
            "64a536392d2c4e6e970f4121",
            "5ca20d5986f774331e7c9602",
            "5c0e746986f7741453628fe5",
            "5ab8dab586f77441cd04f2a2",
            "59e7643b86f7742cbf2c109a",
            "69b10ebfde4dda4a140bddb8",
            "68a986615db8a4a66404ff9a"
          ],
          "dogTagLevel": 0,
          "maxDurability": 100,
          "minDurability": 0,
          "foundInRaid": true
        }
      ],
      "restartable": true,
      "experience": 28000,
      "factionName": "BEAR",
      "availableDelaySecondsMin": 0,
      "availableDelaySecondsMax": 0,
      "normalizedName": "drip-out-part-1-bear",
      "kappaRequired": false,
      "lightkeeperRequired": false,
      "taskImageLink": "https://assets.tarkov.dev/6613f3007f6666d56807c929.webp",
      "map": null
    },
    "66151401efb0539ae10875ae": {
      "id": "66151401efb0539ae10875ae",
      "name": "66151401efb0539ae10875ae name",
      "trader": "5ac3b934156ae10c4430e83c",
      "wikiLink": "https://escapefromtarkov.fandom.com/wiki/Drip-Out_-_Part_1",
      "minPlayerLevel": 27,
      "taskRequirements": [],
      "traderRequirements": [
        {
          "id": "6a6fd15e1ea21a9b791f75b8",
          "requirementType": "level",
          "compareMethod": ">=",
          "value": 3,
          "trader": "5ac3b934156ae10c4430e83c"
        }
      ],
      "objectives": [
        {
          "id": "66151401efb0539ae10875af",
          "description": "66151401efb0539ae10875af",
          "type": "shoot",
          "count": 100,
          "optional": false,
          "shotType": "kill",
          "bodyParts": [],
          "usingWeapon": [],
          "usingWeaponMods": [],
          "distance": {
            "value": 0,
            "compareMethod": ">="
          },
          "timeFromHour": 0,
          "timeUntilHour": 0,
          "wearing": [],
          "notWearing": [],
          "enemyHealthEffect": null,
          "targetNames": [
            "PmcBot"
          ],
          "playerHealthEffect": null,
          "maps": [
            "5b0fc42d86f7744a585f9105",
            "6a294a5b5eb5f9a1700417b7",
            "5704e5fad2720bc05b8b4567"
          ]
        },
        {
          "id": "66168239957ac58c30b29135",
          "description": "66168239957ac58c30b29135",
          "type": "giveItem",
          "count": 50,
          "optional": false,
          "items": [
            "64a536392d2c4e6e970f4121",
            "5ca20d5986f774331e7c9602",
            "5c0e746986f7741453628fe5",
            "5ab8dab586f77441cd04f2a2",
            "59e7643b86f7742cbf2c109a",
            "69b10ebfde4dda4a140bddb8",
            "68a986615db8a4a66404ff9a"
          ],
          "dogTagLevel": 0,
          "maxDurability": 100,
          "minDurability": 0,
          "foundInRaid": true
        }
      ],
      "restartable": true,
      "experience": 28000,
      "factionName": "USEC",
      "availableDelaySecondsMin": 0,
      "availableDelaySecondsMax": 0,
      "normalizedName": "drip-out-part-1-usec",
      "kappaRequired": false,
      "lightkeeperRequired": false,
      "taskImageLink": "https://assets.tarkov.dev/66151401efb0539ae10875ae.webp",
      "map": null
    },
    "596a204686f774576d4c95de": {
      "id": "596a204686f774576d4c95de",
      "name": "596a204686f774576d4c95de name",
      "trader": "54cb57776803fa99248b456e",
      "wikiLink": "https://escapefromtarkov.fandom.com/wiki/Sanitary_Standards_-_Part_2",
      "minPlayerLevel": 8,
      "taskRequirements": [
        {
          "task": "59689ee586f7740d1570bbd5",
          "status": [
            "complete"
          ]
        }
      ],
      "traderRequirements": [],
      "objectives": [
        {
          "id": "5ec1398886f7561e047757a5",
          "description": "5ec1398886f7561e047757a5",
          "type": "findItem",
          "count": 2,
          "optional": false,
          "items": [
            "590a3efd86f77437d351a25b"
          ],
          "dogTagLevel": 0,
          "maxDurability": 100,
          "minDurability": 0,
          "foundInRaid": true,
          "maps": []
        },
        {
          "id": "596a20ac86f7741ddf17dbf4",
          "description": "596a20ac86f7741ddf17dbf4",
          "type": "giveItem",
          "count": 2,
          "optional": false,
          "items": [
            "590a3efd86f77437d351a25b"
          ],
          "dogTagLevel": 0,
          "maxDurability": 100,
          "minDurability": 0,
          "foundInRaid": true
        }
      ],
      "restartable": false,
      "experience": 4500,
      "factionName": "Any",
      "availableDelaySecondsMin": 0,
      "availableDelaySecondsMax": 0,
      "normalizedName": "sanitary-standards-part-2",
      "kappaRequired": false,
      "lightkeeperRequired": false,
      "taskImageLink": "https://assets.tarkov.dev/596a204686f774576d4c95de.webp",
      "map": null
    }
  },
  "tasksEn": {
    "657315ddab5a49b71f098853 name": "First in Line",
    "65732ac3c67dcd96adffa3c7": "Locate the Emercom station on Ground Zero",
    "65817bf31404f3565aef9fec": "Hand over any found in raid medicine items",
    "6834233fecd5cf3a440d855b name": "Against the Conscience - Part 1 [PVE ZONE]",
    "6834233fecd5cf3a440d855f": "Locate the old champion's room on Customs",
    "6834233fecd5cf3a440d8567": "Locate and obtain the key at the smugglers' base on Shoreline",
    "6834233fecd5cf3a440d8561": "Find out what happened to the champion",
    "6834233fecd5cf3a440d8564": "Survive and extract from the location",
    "597a0e5786f77426d66c0636 name": "Chemical - Part 3",
    "597a15b386f774799e5cd152": "Locate and obtain the chemical syringe on Factory",
    "597a15c386f77405ba6887d2": "Hand over the syringe",
    "6613f3007f6666d56807c929 name": "Drip-Out - Part 1",
    "6613f36ca4dc044e13e02295": "Eliminate Raiders",
    "6616819ac7c53d7769413d9c": "Hand over the found in raid WARTECH brand equipment",
    "66151401efb0539ae10875ae name": "Drip-Out - Part 1",
    "66151401efb0539ae10875af": "Eliminate Raiders",
    "66168239957ac58c30b29135": "Hand over the found in raid WARTECH brand equipment",
    "596a204686f774576d4c95de name": "Sanitary Standards - Part 2",
    "5ec1398886f7561e047757a5": "Find Gas analyzers in raid",
    "596a20ac86f7741ddf17dbf4": "Hand over the items"
  },
  "tradersEn": {
    "54cb57776803fa99248b456e Nickname": "Therapist",
    "579dc571d53a0658a154fbec Nickname": "Fence",
    "58330581ace78e27b8b10cee Nickname": "Skier",
    "5ac3b934156ae10c4430e83c Nickname": "Ragman"
  },
  "mapsEn": {
    "653e6760052c01c1c805532f Name": "Ground Zero",
    "56f40101d2720b2a4d8b45d6 Name": "Customs",
    "55f2d3fd4bdc2d5f408b4567 Name": "Factory"
  }
};
