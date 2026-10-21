"use strict";
const path = require("node:path");
const { attachMember } = require("./familyRuntime");
const { readBundle } = require("./delivery");
const { buildSoloPolicy } = require("./policy");
const { permitted } = require("./capability");
function install(gameplayState, api, runtimeRoot, modRoot) {
  if (!gameplayState?.active || !api?.config?.enabled) return { active: false, reason: "gameplay-inactive" };
  const bundle = readBundle(__dirname);
  let policy;
  return attachMember(runtimeRoot, { id: "soloprogressionbalance", bundle,
    eligible: () => permitted(modRoot, runtimeRoot, bundle), policy() {
      if (policy === undefined) {
        const { listItemTypes } = require(path.join(runtimeRoot, "server/src/services/inventory/itemTypeRegistry"));
        const { isMiningModuleItem } = require(path.join(runtimeRoot, "server/src/space/runtime/moduleHeat"));
        policy = buildSoloPolicy(gameplayState, api, listItemTypes(), isMiningModuleItem);
        console.log(`[soloProgressionBalance/simulation] policy ${policy?.revision || "unavailable"}`);
      }
      return policy;
    } });
}
module.exports = { install };
