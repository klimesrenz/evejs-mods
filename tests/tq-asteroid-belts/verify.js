"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

const modRoot = path.resolve(__dirname, "../../mods/tq-asteroid-belts");
const runtimeRoot = path.resolve(process.argv[2] || "C:/projects/EveJS");
process.env.EVEJS_TQ_ASTEROID_BELTS_NO_AUTO_INSTALL = "1";

const viability = require(path.join(modRoot, "lib/viability"));
const transforms = require(path.join(modRoot, "lib/sourceTransforms"));
const { loadManifestFile } = require(path.join(modRoot, "lib/api"));
const loader = require(path.join(modRoot, "loader"));

const target = viability.run(runtimeRoot);
assert.ok(target.source.length > 0);
const transformed = transforms.transformAsteroidService(target.source);
new Function("require", "module", "exports", "__filename", "__dirname", transformed);
console.log("PASS a: clean EveJS target passes preflight and transformed source compiles");

const installation = loader.install({
  runtimeRoot,
  manifestPath: path.join(modRoot, "data/asteroid-counts.json.gz"),
});
assert.equal(installation.active, true);
assert.deepEqual(globalThis[Symbol.for("evejs.fourModeAsteroidBelts")], { blockedBy: "tqasteroidbelts" });
assert.deepEqual(installation.api.summary, {
  beltCount: 40928,
  asteroidCount: 2123854,
  typeCount: 249314,
  maximumBeltCount: 186,
  maximumBeltID: 40161349,
});
console.log("PASS b: loader installed with the pinned 2,123,854-asteroid manifest");

const asteroidData = require(path.join(runtimeRoot, "server/src/space/asteroids/asteroidData.js"));
const asteroidService = require(path.join(runtimeRoot, "server/src/space/asteroids/asteroidService.js"));
const { resolveItemByTypeID } = require(path.join(runtimeRoot, "server/src/services/inventory/itemTypeRegistry.js"));
const { classifyMiningMaterialType } = require(path.join(runtimeRoot, "server/src/services/mining/miningInventory.js"));
const manifest = loadManifestFile(path.join(modRoot, "data/asteroid-counts.json.gz"));
const runtimeBelts = asteroidData.ensureLoaded().belts;
assert.equal(runtimeBelts.length, manifest.belts.size);
for (const belt of runtimeBelts) {
  assert.ok(manifest.belts.has(Number(belt.itemID)), `manifest is missing runtime belt ${belt.itemID}`);
}
const uniqueTypeIDs = new Set();
for (const entries of manifest.belts.values()) {
  for (const entry of entries) uniqueTypeIDs.add(entry.typeID);
}
for (const typeID of uniqueTypeIDs) {
  const row = resolveItemByTypeID(typeID);
  assert.ok(row, `runtime item registry is missing TQ asteroid type ${typeID}`);
  assert.equal(classifyMiningMaterialType(row).kind, "ore", `TQ asteroid type ${typeID} is not classified as ore`);
}
console.log(`PASS c: manifest covers all ${runtimeBelts.length} runtime belts and ${uniqueTypeIDs.size} ore types`);

const belt = asteroidData.getBeltsForSystem(30000143).find((candidate) => Number(candidate.itemID) === 40009129);
assert.ok(belt, "Niyabainen reference belt 40009129 must exist");
const entities = [];
const scene = {
  systemID: 30000143,
  staticEntities: entities,
  addStaticEntity(entity) {
    if (entities.some((candidate) => candidate.itemID === entity.itemID)) return false;
    entities.push(entity);
    return true;
  },
};
const spawned = asteroidService._testing.populateBeltField(scene, belt);
assert.equal(spawned.length, 72);
assert.equal(new Set(spawned.map((entity) => entity.itemID)).size, 72);
assert.ok(spawned.every((entity) => entity.generatedFromTqManifest === true));
assert.ok(spawned.every((entity) => entity.tqManifestClientBuild === 3632936));
const counts = {};
for (const entity of spawned) {
  counts[entity.miningYieldTypeID] = (counts[entity.miningYieldTypeID] || 0) + 1;
}
assert.deepEqual(counts, {
  1228: 21,
  1230: 25,
  17463: 14,
  17464: 1,
  17470: 8,
  17471: 3,
});
console.log("PASS d: transformed runtime spawned belt 40009129 with exact TQ type counts");

const customEntities = [];
const customBelt = {
  ...belt,
  itemID: 49999999,
  itemName: "Custom Asteroid Belt",
  fieldSeed: 49999999,
  asteroidCount: 3,
};
const customScene = {
  systemID: 30000143,
  staticEntities: customEntities,
  addStaticEntity(entity) {
    if (customEntities.some((candidate) => candidate.itemID === entity.itemID)) return false;
    customEntities.push(entity);
    return true;
  },
};
const customSpawned = asteroidService._testing.populateBeltField(customScene, customBelt);
assert.ok(customSpawned.length >= 3);
assert.ok(customSpawned.every((entity) => entity.generatedFromTqManifest !== true));
assert.ok(customSpawned.every((entity) => entity.generatedFromSystemIDTable === true));
console.log("PASS e: belt absent from the manifest retains native EveJS generation");
console.log("RESULT: targeted verifier passed");
