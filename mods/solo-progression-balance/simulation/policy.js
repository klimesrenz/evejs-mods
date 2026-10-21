"use strict";
const crypto = require("node:crypto");
const { SUPPORTED_EVEJS_VERSION } = require("./delivery");
const { ATTRIBUTE_MINING_AMOUNT, MINING_HOLD_ATTRIBUTE_IDS } = require("../lib/miningBalance");
const { ATTRIBUTE_CARGO_CAPACITY, FLEET_HANGAR_ATTRIBUTE_ID } = require("../lib/logisticsBalance");
const { DRONE_CATEGORY_ID } = require("../lib/clientSync");

// Observe the authoritative mutators' writes, including repeated attributes.
// This compiles their applicability into ordered positive-only operations.
function capacityProgram(api, metadata) {
  const ids = [...new Set([ATTRIBUTE_CARGO_CAPACITY, FLEET_HANGAR_ATTRIBUTE_ID,
    ...api.getSpecialAttributeIDs(), ...MINING_HOLD_ATTRIBUTE_IDS])];
  const context = { characterID: 1, shipItem: metadata, shipMetadata: metadata };
  const program = {};
  for (const [mutate, factor] of [[api.applyLogisticsCargoScale, api.config.logisticsCargoScale],
    [api.applyMiningHoldScale, api.config.miningHoldScale]]) {
    if (!Number.isFinite(factor) || factor <= 0) throw Error("Invalid loaded Solo scale");
    const attributes = Object.fromEntries(ids.map(id => [id, 1]));
    const traced = new Proxy(attributes, { set(target, key, value) {
      if (!ids.includes(Number(key))) throw Error("Unexpected Solo capacity attribute");
      (program[key] ||= []).push(factor);
      // Keep the symbolic probe positive so tiny scales cannot hide a later
      // repeated operation. The client tests positivity on its real value.
      target[key] = 1;
      return true;
    } });
    mutate(traced, context);
  }
  // Pure x1 is deliberately native. Mixed stages retain even their x1 rounding.
  for (const key of Object.keys(program)) if (program[key].every(x => x === 1)) delete program[key];
  return program;
}

function buildSoloPolicy(state, api, catalog, isMiningModuleItem) {
  if (!state?.active || !api?.config?.enabled) return null;
  const programs = [], ships = {}, indexes = new Map(), modules = [], drones = [];
  for (const metadata of [...catalog].sort((a, b) => a.typeID - b.typeID)) {
    const typeID = Number(metadata.typeID), category = Number(metadata.categoryID);
    if (!Number.isSafeInteger(typeID) || typeID <= 0) throw Error("Invalid catalog type");
    if (category === 6) {
      const program = capacityProgram(api, metadata);
      if (Object.keys(program).length) {
        const key = JSON.stringify(program);
        if (!indexes.has(key)) { indexes.set(key, programs.length); programs.push(program); }
        ships[typeID] = indexes.get(key);
      }
    } else if (category === 7 && isMiningModuleItem(metadata)) modules.push(typeID);
    else if (category === DRONE_CATEGORY_ID) drones.push(typeID);
  }
  const moduleScale = api.config.miningYieldScale, droneScale = api.config.miningDroneYieldScale;
  for (const factor of [moduleScale, droneScale]) if (!Number.isFinite(factor) || factor <= 0) throw Error("Invalid loaded Solo mining scale");
  // Only resolved simulation data; no character, account, environment or settings object.
  const provider = { schema: 1, capacityPrograms: programs, ships, miningAttribute: ATTRIBUTE_MINING_AMOUNT,
    moduleTypes: moduleScale === 1 ? [] : modules, moduleScale,
    droneTypes: droneScale === 1 ? [] : drones, droneScale };
  const policy = { schema: 1, evejs: SUPPORTED_EVEJS_VERSION, clientBuild: 3396210,
    providers: { soloprogressionbalance: provider } };
  policy.revision = crypto.createHash("sha256").update(JSON.stringify(policy)).digest("hex");
  return policy;
}
module.exports = { buildSoloPolicy, capacityProgram };
