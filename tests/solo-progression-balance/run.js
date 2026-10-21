"use strict";

const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const modDir = path.resolve(__dirname, "../../mods/solo-progression-balance");
const candidateRoot = path.resolve(process.env.EVEJS_ROOT || path.resolve(__dirname, "../../../EveJS"));
const loaderPath = path.join(modDir, "loader.js");
const results = [];

function test(name, operation) {
  operation();
  results.push(name);
  console.log(`PASS ${name}`);
}

function hashFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, {
    encoding: "utf8",
    timeout: 30000,
    ...options,
  });
}

function createSpaceRuntimeTransformFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "solo-progression-transform-"));
  const targetDir = path.join(root, "server", "src", "space", "runtime");
  const targetFile = path.join(targetDir, "moduleAttributes.js");
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(
    path.join(targetDir, "moduleHeat.js"),
    '"use strict"; exports.isMiningModuleItem = () => true;\n',
    "utf8",
  );
  fs.writeFileSync(targetFile, `"use strict";
function resolveGenericModuleAttributeOverrides() { return { 73: 45000, 77: 517 }; }
function isMiningModuleItem() { return true; }
function getGenericModuleRuntimeAttributes() {
  const characterID = 90000001;
  const shipItem = {};
  const moduleItem = {};
  const chargeItem = null;
  const options = {};
  const attributeOverrides = resolveGenericModuleAttributeOverrides(
    characterID,
    shipItem,
    moduleItem,
    chargeItem,
    options,
  );
  return attributeOverrides;
}
module.exports = { getGenericModuleRuntimeAttributes };
`, "utf8");
  return {
    request: path.join(root, "server", "src", "space", "runtime", "moduleAttributes"),
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function parseChildResult(stdout) {
  const line = String(stdout || "").split(/\r?\n/u).find((entry) => entry.startsWith("RESULT:"));
  assert.ok(line, `missing child result in output: ${stdout}`);
  return JSON.parse(line.slice("RESULT:".length));
}

const configModule = require(path.join(modDir, "config"));
const { createRuntimeApi } = require(path.join(modDir, "lib/runtimeApi"));
const overlays = require(path.join(modDir, "lib/overlays"));
const transforms = require(path.join(modDir, "lib/sourceTransforms"));
const viability = require(path.join(modDir, "lib/viability"));
const previousEnabledValue = process.env.EVEJS_SOLO_PROGRESSION_BALANCE;
process.env.EVEJS_SOLO_PROGRESSION_BALANCE = "0";
const loaderModule = require(loaderPath);
if (previousEnabledValue === undefined) {
  delete process.env.EVEJS_SOLO_PROGRESSION_BALANCE;
} else {
  process.env.EVEJS_SOLO_PROGRESSION_BALANCE = previousEnabledValue;
}

const GENERIC_SPECIAL_HOLD_IDS = [
  1558, 1559, 1560, 1561, 1562, 1563, 1564, 1573,
  1646, 1653, 1804, 2467, 2657, 2675, 5646, 5944,
];
const SPECIAL_HOLD_DEFINITIONS = [
  { attributeIDs: [1549], managedBy: "fuel" },
  { attributeIDs: [1556], managedBy: "mining" },
  { attributeIDs: [1557], managedBy: "mining" },
  ...GENERIC_SPECIAL_HOLD_IDS.map((attributeID) => ({ attributeIDs: [attributeID] })),
  { attributeIDs: [3136], managedBy: "mining" },
  { attributeIDs: [3227], managedBy: "mining" },
  { attributeIDs: [5325], managedBy: "mobileDepot" },
];

function makeConfig(overrides = {}) {
  return Object.freeze({
    enabled: true,
    miningYieldScale: 3,
    miningDroneYieldScale: 3,
    miningHoldScale: 3,
    logisticsCargoScale: 2,
    verbose: false,
    problems: Object.freeze([]),
    ...overrides,
  });
}

function makeApi(overrides = {}) {
  return createRuntimeApi(makeConfig(overrides), candidateRoot, {
    specialHoldDefinitions: SPECIAL_HOLD_DEFINITIONS,
  });
}

test("mod owns all four scales and has no schema overlay", () => {
  const loaded = configModule.load(modDir, { [configModule.KEYS.enabled]: "1" });
  assert.strictEqual(loaded.enabled, true);
  assert.deepStrictEqual(
    [loaded.miningYieldScale, loaded.miningDroneYieldScale, loaded.miningHoldScale, loaded.logisticsCargoScale],
    [3, 3, 3, 2],
  );
  assert.strictEqual(fs.existsSync(path.join(modDir, "lib/schemaOverlay.js")), false);
});

test("vendor config and schema contain none of the four private balance keys", () => {
  const miningConfig = JSON.parse(fs.readFileSync(path.join(candidateRoot, "config/mining.json"), "utf8"));
  const serverConfig = JSON.parse(fs.readFileSync(path.join(candidateRoot, "config/server.json"), "utf8"));
  const miningSchema = fs.readFileSync(path.join(candidateRoot, "server/src/config/schema/mining.js"), "utf8");
  const gameplaySchema = fs.readFileSync(path.join(candidateRoot, "server/src/config/schema/gameplay.js"), "utf8");
  for (const key of ["miningYieldScale", "miningDroneYieldScale", "miningHoldScale"]) {
    assert.strictEqual(Object.hasOwn(miningConfig.general, key), false);
    assert.doesNotMatch(miningSchema, new RegExp(key, "u"));
  }
  assert.strictEqual(Object.hasOwn(serverConfig.network, "logisticsCargoScale"), false);
  assert.doesNotMatch(gameplaySchema, /logisticsCargoScale/u);
});

test("missing mod .env defaults to disabled with the accepted scale defaults", () => {
  const loaded = configModule.load(path.join(modDir, "does-not-exist"), {});
  assert.strictEqual(loaded.enabled, false);
  assert.deepStrictEqual(
    [loaded.miningYieldScale, loaded.miningDroneYieldScale, loaded.miningHoldScale, loaded.logisticsCargoScale],
    [3, 3, 3, 2],
  );
});

test("real environment overrides mod .env and supports explicit vanilla x1", () => {
  const keys = configModule.KEYS;
  const loaded = configModule.load(modDir, {
    [keys.enabled]: "1",
    [keys.miningYieldScale]: "1",
    [keys.miningDroneYieldScale]: "1",
    [keys.miningHoldScale]: "1",
    [keys.logisticsCargoScale]: "1",
  });
  assert.deepStrictEqual(
    [loaded.miningYieldScale, loaded.miningDroneYieldScale, loaded.miningHoldScale, loaded.logisticsCargoScale],
    [1, 1, 1, 1],
  );
});

test("scale settings enforce the same 0.01 to 100 bounds as the Launcher manifest", () => {
  const key = configModule.KEYS.miningYieldScale;
  for (const value of ["0.009", "101", "1e308", "Infinity"]) {
    const loaded = configModule.load(modDir, {[key]: value});
    assert.strictEqual(loaded.miningYieldScale, configModule.DEFAULTS.miningYieldScale, value);
    assert.deepStrictEqual(loaded.problems, ["miningYieldScale must be between 0.01 and 100"], value);
  }
  for (const value of ["0.01", "100"]) {
    const loaded = configModule.load(modDir, {[key]: value});
    assert.strictEqual(loaded.miningYieldScale, Number(value));
    assert.deepStrictEqual(loaded.problems, []);
  }
});

test("module authoritative snapshot scales attribute 77 once after ordinary modifiers", () => {
  const api = makeApi();
  const source = { miningAmountM3: 388, durationMs: 45000, moduleAttributes: { 73: 45000, 77: 388, 54: 15000 } };
  const result = api.scaleMiningModuleSnapshot(source, { characterID: 90000001 });
  assert.strictEqual(result.miningAmountM3, 1164);
  assert.strictEqual(result.moduleAttributes[77], 1164);
  assert.strictEqual(result.durationMs, 45000);
  assert.strictEqual(result.moduleAttributes[54], 15000);
  assert.strictEqual(source.miningAmountM3, 388);
});

test("NPC mining module stays vanilla", () => {
  const api = makeApi();
  const source = { miningAmountM3: 100, durationMs: 60000, moduleAttributes: { 73: 60000, 77: 100 } };
  assert.strictEqual(api.scaleMiningModuleSnapshot(source, { characterID: 0 }), source);
});

test("Mining Drone operational and authoritative snapshots scale once without cache mutation", () => {
  const api = makeApi();
  const controller = { session: { characterID: 90000001 } };
  const cachedAttributes = { 64: 2, 73: 60000, 77: 68 };
  const operational = api.scaleDroneOperationalAttributes(cachedAttributes, controller);
  const snapshot = api.scaleDroneMiningSnapshot({ durationMs: 60000, miningAmountM3: 68 }, controller);
  assert.strictEqual(operational[77], 204);
  assert.strictEqual(snapshot.miningAmountM3, 204);
  assert.strictEqual(operational[73], 60000);
  assert.strictEqual(cachedAttributes[77], 68);
});

test("non-player drone controller stays vanilla", () => {
  const api = makeApi();
  const attrs = { 73: 60000, 77: 68 };
  assert.strictEqual(api.scaleDroneOperationalAttributes(attrs, { ownerID: 0 }), attrs);
});

test("Mining Gas Ice and Ore holds scale x3 and unrelated capacities do not", () => {
  const api = makeApi();
  const attrs = { 38: 1000, 1556: 5000, 1557: 6000, 3136: 7000, 3227: 8000, 1549: 9000 };
  api.applyMiningHoldScale(attrs, { characterID: 90000001 });
  assert.deepStrictEqual(attrs, { 38: 1000, 1556: 15000, 1557: 18000, 3136: 21000, 3227: 24000, 1549: 9000 });
});

test("all seven accepted logistics groups receive cargo Fleet Hangar and generic holds x2", () => {
  const api = makeApi();
  for (const groupID of [28, 380, 513, 883, 902, 941, 1202]) {
    const attrs = { 38: 100, 912: 200, 1558: 300, 1653: 400 };
    api.applyLogisticsCargoScale(attrs, { characterID: 90000001, shipItem: { groupID } });
    assert.deepStrictEqual(attrs, { 38: 200, 912: 400, 1558: 600, 1653: 800 });
  }
});

test("logistics generic specialized hold set exactly matches the source-patched policy", () => {
  const api = makeApi();
  assert.deepStrictEqual(api.getSpecialAttributeIDs(), GENERIC_SPECIAL_HOLD_IDS);
});

test("combat ships and NPC/no-character paths stay vanilla", () => {
  const api = makeApi();
  const combat = { 38: 100, 912: 200, 1558: 300 };
  api.applyLogisticsCargoScale(combat, { characterID: 90000001, shipItem: { groupID: 25 } });
  assert.deepStrictEqual(combat, { 38: 100, 912: 200, 1558: 300 });
  const npc = { 38: 100 };
  api.applyLogisticsCargoScale(npc, { characterID: 0, shipItem: { groupID: 28 } });
  assert.deepStrictEqual(npc, { 38: 100 });
});

test("Miasmos cargo x2 and Mining Hold x3 never compose to x6", () => {
  const api = makeApi();
  const attrs = { 38: 1000, 1556: 5000 };
  api.applyShipCapacityScales(attrs, { characterID: 90000001, shipItem: { groupID: 28 } });
  assert.deepStrictEqual(attrs, { 38: 2000, 1556: 15000 });
});

test("Porpoise cargo and Fleet Hangar x2 Mining Hold x3 Fuel Bay unchanged", () => {
  const api = makeApi();
  const attrs = { 38: 500, 912: 5000, 1556: 10000, 1549: 8000 };
  api.applyShipCapacityScales(attrs, { characterID: 90000001, shipItem: { groupID: 941 } });
  assert.deepStrictEqual(attrs, { 38: 1000, 912: 10000, 1556: 30000, 1549: 8000 });
});

test("Epithal cargo and planetary transport hold scale x2", () => {
  const api = makeApi();
  const attrs = { 38: 500, 1653: 45000 };
  api.applyShipCapacityScales(attrs, { characterID: 90000001, shipItem: { groupID: 28 } });
  assert.deepStrictEqual(attrs, { 38: 1000, 1653: 90000 });
});

test("Fuel Mobile Depot Drone Fighter and Ship Maintenance capacities remain unchanged", () => {
  const api = makeApi();
  const attrs = { 1549: 1, 5325: 2, 283: 3, 2217: 4, 908: 5 };
  api.applyShipCapacityScales(attrs, { characterID: 90000001, shipItem: { groupID: 941 } });
  assert.deepStrictEqual(attrs, { 1549: 1, 5325: 2, 283: 3, 2217: 4, 908: 5 });
});

test("live mining module tooltip scales the complete effective map only", () => {
  const api = makeApi();
  const effective = { 73: 45000, 77: 517, 54: 22500, 999: 12 };
  const result = api.applyMiningModuleClientSync(90000001, true, effective);
  assert.deepStrictEqual(result, { 73: 45000, 77: 1551, 54: 22500, 999: 12 });
  assert.strictEqual(effective[77], 517);
  assert.strictEqual(api.applyMiningModuleClientSync(90000001, false, effective), effective);
});

test("Mining Drone client delta owns only already-authoritative attr77", () => {
  const api = makeApi();
  assert.deepStrictEqual(api.buildMiningDroneClientAttributeOverrides({ 64: 2, 73: 60000, 77: 204 }), { 77: 204 });
  assert.strictEqual(api.buildMiningDroneClientAttributeOverrides({ 64: 2, 73: 60000 }), null);
});

test("in-space mining-drone prime preserves complete ship Dogma while applying Solo once", () => {
  const api = makeApi();
  const controller = { session: { characterID: 90000001 } };
  const typeAttributes = { 54: 5000, 64: 2, 73: 271000, 77: 512, 160: 0.25 };
  const shipAndSkillResolvedAttributes = {
    ...typeAttributes,
    54: 7250,
    73: 137500,
    160: 0.4375,
  };
  const soloOperationalAttributes = api.scaleDroneOperationalAttributes(
    shipAndSkillResolvedAttributes,
    controller,
  );
  const mergedOverrides = api.mergeMiningDroneClientAttributeOverrides(
    shipAndSkillResolvedAttributes,
    soloOperationalAttributes,
  );
  const vanillaPrimeAttributes = {
    ...typeAttributes,
    ...shipAndSkillResolvedAttributes,
  };
  const soloPrimeAttributes = { ...typeAttributes, ...mergedOverrides };

  assert.strictEqual(vanillaPrimeAttributes[77], 512);
  assert.strictEqual(vanillaPrimeAttributes[73], 137500);
  assert.strictEqual(soloPrimeAttributes[77], 1536);
  assert.strictEqual(soloPrimeAttributes[73], 137500);
  assert.strictEqual(soloPrimeAttributes[54], 7250);
  assert.strictEqual(soloPrimeAttributes[160], 0.4375);
  assert.strictEqual(shipAndSkillResolvedAttributes[77], 512);
  assert.strictEqual(soloOperationalAttributes[77], 1536);

  const vanillaApi = makeApi({ miningDroneYieldScale: 1 });
  const vanillaOperationalAttributes = vanillaApi.scaleDroneOperationalAttributes(
    shipAndSkillResolvedAttributes,
    controller,
  );
  assert.deepStrictEqual(
    vanillaApi.mergeMiningDroneClientAttributeOverrides(
      shipAndSkillResolvedAttributes,
      vanillaOperationalAttributes,
    ),
    shipAndSkillResolvedAttributes,
  );

  const unrelatedDroneAttributes = { 54: 8000, 64: 1.5, 73: 4000 };
  assert.strictEqual(
    api.mergeMiningDroneClientAttributeOverrides(
      unrelatedDroneAttributes,
      unrelatedDroneAttributes,
    ),
    unrelatedDroneAttributes,
  );

  const npcOperationalAttributes = api.scaleDroneOperationalAttributes(
    shipAndSkillResolvedAttributes,
    { ownerID: 0 },
  );
  assert.strictEqual(npcOperationalAttributes, shipAndSkillResolvedAttributes);
  assert.deepStrictEqual(
    api.mergeMiningDroneClientAttributeOverrides(
      shipAndSkillResolvedAttributes,
      npcOperationalAttributes,
    ),
    shipAndSkillResolvedAttributes,
  );
});

function liveDroneContext() {
  return {
    item: { itemID: 7001, typeID: 10250, ownerID: 90000001, locationID: 30000142, flagID: 0, categoryID: 18 },
    runtimeEntity: {
      kind: "drone", itemID: 7001, typeID: 10250, ownerID: 90000001,
      controllerID: 5001, controllerOwnerID: 90000001, systemID: 30000142,
      categoryID: 18, passiveDerivedState: { attributes: { 64: 2, 73: 60000, 77: 204 } },
    },
    controllerEntity: { kind: "ship", itemID: 5001, ownerID: 90000001, pilotCharacterID: 90000001, systemID: 30000142 },
    characterID: 90000001,
    shipID: 5001,
  };
}

test("async V4 lifecycle finishes at authoritative 204 after late ItemGetInfo", () => {
  const api = makeApi();
  let clientAttribute77 = 33;
  clientAttribute77 = api.buildMiningDroneClientAttributeOverrides({ 77: 204 })[77];
  const pendingItemGetInfo = () => api.buildLiveMiningDroneItemInfoAttributeOverrides(liveDroneContext())[77];
  clientAttribute77 = pendingItemGetInfo();
  assert.strictEqual(clientAttribute77, 204);
});

test("V4 guard rejects Drone Bay non-mining unrelated and foreign drones", () => {
  const api = makeApi();
  const bay = liveDroneContext();
  bay.item.flagID = 87;
  bay.item.locationID = bay.shipID;
  assert.strictEqual(api.buildLiveMiningDroneItemInfoAttributeOverrides(bay), null);
  const nonMining = liveDroneContext();
  delete nonMining.runtimeEntity.passiveDerivedState.attributes[77];
  assert.strictEqual(api.buildLiveMiningDroneItemInfoAttributeOverrides(nonMining), null);
  const foreign = liveDroneContext();
  foreign.runtimeEntity.ownerID = 90000002;
  foreign.runtimeEntity.controllerOwnerID = 90000002;
  assert.strictEqual(api.buildLiveMiningDroneItemInfoAttributeOverrides(foreign), null);
  const unrelated = liveDroneContext();
  unrelated.item.categoryID = 6;
  assert.strictEqual(api.buildLiveMiningDroneItemInfoAttributeOverrides(unrelated), null);
});

test("Mining Dogma export wrapper applies x3 exactly once", () => {
  const api = makeApi();
  const originalSnapshot = { miningAmountM3: 100, durationMs: 60000, moduleAttributes: { 73: 60000, 77: 100 } };
  const fake = { buildMiningModuleSnapshot: () => originalSnapshot };
  assert.strictEqual(overlays.installMiningDogma(fake, api), true);
  assert.strictEqual(overlays.installMiningDogma(fake, api), false);
  const result = fake.buildMiningModuleSnapshot({ characterID: 90000001 });
  assert.strictEqual(result.miningAmountM3, 300);
  assert.strictEqual(result.durationMs, 60000);
  assert.strictEqual(originalSnapshot.miningAmountM3, 100);
});

test("Drone Dogma wrappers keep original cached objects unscaled", () => {
  const api = makeApi();
  const cachedAttrs = { 73: 60000, 77: 68 };
  const cachedSnapshot = { durationMs: 60000, miningAmountM3: 68 };
  const fake = {
    resolveDroneOperationalAttributes: () => cachedAttrs,
    resolveDroneMiningSnapshot: () => cachedSnapshot,
  };
  overlays.installDroneDogma(fake, api);
  const controller = { session: { characterID: 90000001 } };
  assert.strictEqual(fake.resolveDroneOperationalAttributes({}, controller)[77], 204);
  assert.strictEqual(fake.resolveDroneOperationalAttributes({}, controller)[77], 204);
  assert.strictEqual(fake.resolveDroneMiningSnapshot({}, controller).miningAmountM3, 204);
  assert.strictEqual(cachedAttrs[77], 68);
  assert.strictEqual(cachedSnapshot.miningAmountM3, 68);
});

test("Fitting snapshot overlay preserves the accepted server-side fitted attr77 only", () => {
  const fake = {
    buildFittingSnapshot: () => ({
      characterID: 90000001,
      shipItem: { itemID: 5001 },
      fittedItems: [{ itemID: 8001, typeID: 9000, categoryID: 8, flagID: 27 }],
      skillMap: new Map(),
      assumedActiveModuleContexts: [],
      getModuleAttributeOverrides: () => ({ 30: 10, 50: 20 }),
    }),
  };
  overlays.installFittingSnapshotBuilder(fake, candidateRoot, {
    miningDogma: { buildMiningModuleSnapshot: () => ({ miningAmountM3: 300 }) },
    resolveItemByTypeID: () => ({ categoryID: 8 }),
  });
  const snapshot = fake.buildFittingSnapshot();
  assert.deepStrictEqual(snapshot.getModuleAttributeOverrides({ itemID: 7001, flagID: 27 }), { 30: 10, 50: 20, 77: 300 });
});

test("DogmaService ItemGetInfo prefers refreshed operational amount over stale passive state", () => {
  const api = makeApi();
  const context = liveDroneContext();
  class FakeDogmaService {
    _getCharID() { return context.characterID; }
    _getShipID() { return context.shipID; }
    _buildInventoryItemAttributes() { return { 73: 60000, 77: 33 }; }
  }
  FakeDogmaService._testing = { marshalDogmaAttributeValue: (_id, value) => value };
  const scene = {
    getEntityByID: () => context.runtimeEntity,
    getShipEntityForSession: () => context.controllerEntity,
  };
  overlays.installDogmaService(FakeDogmaService, api, candidateRoot, {
    spaceRuntime: { getSceneForSession: () => scene },
    droneDogma: {
      resolveDroneOperationalAttributes: () => ({ 73: 60000, 77: 306 }),
    },
  });
  const result = new FakeDogmaService()._buildInventoryItemAttributes(context.item, {});
  assert.strictEqual(context.runtimeEntity.passiveDerivedState.attributes[77], 204);
  assert.strictEqual(result[77], 306);
  assert.strictEqual(result[73], 60000);
});

test("all three clean-source transforms are viable line-count preserving and syntax-valid", () => {
  const report = transforms.inspect(candidateRoot);
  assert.strictEqual(report.ok, true, JSON.stringify(report));
  for (const entry of report.reports) {
    const source = fs.readFileSync(entry.filename, "utf8");
    const transformed = transforms.transformSource(entry.filename, source);
    assert.strictEqual(transformed.ok, true, transformed.reason);
    assert.strictEqual(transformed.source.split("\n").length, source.split("\n").length);
    assert.doesNotThrow(() => new Function("exports", "require", "module", "__filename", "__dirname", transformed.source));
  }
});

test("Windows mixed-case and separator variants canonicalize to one target", () => {
  const options = { platform: "win32", realpath: (value) => value };
  assert.strictEqual(
    loaderModule.canonicalize("C:\\EVEJS\\Server\\src\\space\\runtime.js", options),
    loaderModule.canonicalize("c:/evejs/server/src/space/runtime.JS", options),
  );
});

test("canonicalization resolves realpath aliases", () => {
  const canonical = "C:\\EveJS\\server\\src\\space\\runtime.js";
  const options = { platform: "win32", realpath: () => canonical };
  assert.strictEqual(
    loaderModule.canonicalize("C:\\alias\\runtime.js", options),
    loaderModule.canonicalize(canonical, options),
  );
});

test("Linux-style canonicalization remains case-sensitive", () => {
  const options = { platform: "linux", realpath: (value) => value };
  assert.notStrictEqual(
    loaderModule.canonicalize("/app/server/src/space/runtime.js", options),
    loaderModule.canonicalize("/app/Server/src/space/runtime.js", options),
  );
});

test("exact canonical target map contains all three transforms and four overlays", () => {
  const targets = loaderModule._testing.buildCanonicalTargetMap(candidateRoot, transforms);
  assert.strictEqual(targets.size, 7);
  assert.strictEqual([...targets.values()].filter((target) => target.kind === "transform").length, 3);
  assert.strictEqual([...targets.values()].filter((target) => target.kind === "overlay").length, 4);
});

test("mixed-case resolved transform request is applied once and reuses canonical exports", () => {
  const fixture = createSpaceRuntimeTransformFixture();
  const runtimeRoot = path.resolve(path.dirname(fixture.request), "../../../..");
  const api = { applyMiningModuleClientSync: (_characterID, _isMining, attributes) => ({ ...attributes, 77: 1551 }) };
  const apiMarker = Symbol.for(loaderModule.API_SYMBOL);
  globalThis[apiMarker] = api;
  const state = loaderModule._testing.installModuleHook(api, runtimeRoot, false);
  const exactRequest = fixture.request;
  const mixedRequest = exactRequest.replace(/server/iu, "SERVER").replace(/space/iu, "SPACE");
  try {
    const first = require(mixedRequest);
    const second = require(exactRequest);
    assert.strictEqual(first, second);
    assert.strictEqual(first.getGenericModuleRuntimeAttributes()[77], 1551);
    assert.strictEqual(state.transformed.size, 1);
  } finally {
    Module._load = state.previousLoad;
    delete globalThis[apiMarker];
    for (const filename of Object.keys(Module._cache)) {
      if (loaderModule.canonicalize(filename).startsWith(loaderModule.canonicalize(runtimeRoot))) {
        delete Module._cache[filename];
      }
    }
    fixture.cleanup();
  }
});

test("EveJS 261018.1 viability gate accepts the current runtime", () => {
  const report = viability.inspect(candidateRoot);
  assert.strictEqual(report.ok, true, JSON.stringify(report));
});

test("transform inspection never changes vendor source bytes", () => {
  for (const suffix of Object.values(transforms.TARGETS)) {
    const file = path.join(candidateRoot, ...suffix.split("/"));
    const before = hashFile(file);
    transforms.transformSource(file, fs.readFileSync(file, "utf8"));
    assert.strictEqual(hashFile(file), before);
  }
});

test("x1 API preserves vanilla module drone hold logistics and tooltip values", () => {
  const api = makeApi({
    miningYieldScale: 1,
    miningDroneYieldScale: 1,
    miningHoldScale: 1,
    logisticsCargoScale: 1,
  });
  assert.strictEqual(api.scaleMiningYield(100), 100);
  assert.strictEqual(api.scaleMiningDroneYield(68), 68);
  const attrs = { 38: 1000, 912: 2000, 1556: 5000 };
  api.applyShipCapacityScales(attrs, { characterID: 90000001, shipItem: { groupID: 941 } });
  assert.deepStrictEqual(attrs, { 38: 1000, 912: 2000, 1556: 5000 });
  assert.strictEqual(api.applyMiningModuleClientSync(90000001, true, { 77: 517 })[77], 517);
});

test("disabled loader installs no hook and exposes no runtime API", () => {
  const loader = path.join(modDir, "loader.js");
  const vendorConfig = path.join(candidateRoot, "server/src/config");
  const code = `const Module=require('node:module');const before=Module._load;const l=require(${JSON.stringify(loader)});` +
    `const c=require(${JSON.stringify(vendorConfig)});` +
    `console.log('RESULT:'+JSON.stringify({active:l.installResult.active,same:before===Module._load,api:!!globalThis[Symbol.for('evejs.soloProgressionBalance')],vendorMining:Object.hasOwn(c,'miningYieldScale'),vendorLogistics:Object.hasOwn(c,'logisticsCargoScale')}));`;
  const child = runNode(["-e", code], {
    env: { ...process.env, EVEJS_SOLO_PROGRESSION_BALANCE: "0" },
  });
  assert.strictEqual(child.status, 0, child.stderr);
  assert.match(child.stdout, /"active":false,"same":true,"api":false,"vendorMining":false,"vendorLogistics":false/u);
});

test("invalid enabled mod config fails closed before installing hooks", () => {
  const loader = path.join(modDir, "loader.js");
  const code = `const Module=require('node:module');const before=Module._load;const l=require(${JSON.stringify(loader)});` +
    `console.log('RESULT:'+JSON.stringify({active:l.installResult.active,reason:l.installResult.reason,same:before===Module._load}));`;
  const child = runNode(["-e", code], {
    env: {
      ...process.env,
      EVEJS_SOLO_PROGRESSION_BALANCE: "1",
      EVEJS_SOLO_MINING_YIELD_SCALE: "0",
    },
  });
  assert.strictEqual(child.status, 0, child.stderr);
  assert.match(child.stdout, /"active":false,"reason":"invalid-config","same":true/u);
});

test("enabled loader arms the self-contained API without touching EveJS schema", () => {
  const loader = path.join(modDir, "loader.js");
  const code = `const l=require(${JSON.stringify(loader)});` +
    `const state=l.install({runtimeRoot:${JSON.stringify(candidateRoot)},environment:{EVEJS_SOLO_PROGRESSION_BALANCE:'1'}});` +
    `const a=globalThis[Symbol.for('evejs.soloProgressionBalance')];` +
    `console.log('RESULT:'+JSON.stringify({active:state.active,module:a.scaleMiningYield(100),logistics:a.config.logisticsCargoScale}));`;
  const child = runNode(["-e", code], {
    env: { ...process.env, EVEJS_SOLO_PROGRESSION_BALANCE: "0" },
  });
  assert.strictEqual(child.status, 0, child.stderr);
  assert.match(child.stdout, /"active":true,"module":300,"logistics":2/u);
});

test("all seven required targets reject pre-cached activation without leaking state", () => {
  const code = `const Module=require('node:module');const before=Module._load;` +
    `const l=require(${JSON.stringify(loaderPath)});const t=require(${JSON.stringify(path.join(modDir, "lib/sourceTransforms.js"))});` +
    `const targets=l._testing.buildCanonicalTargetMap(${JSON.stringify(candidateRoot)},t);const failures=[];` +
    `for(const target of targets.values()){Module._cache[target.filename]={exports:{}};let message='';` +
    `try{l.install({runtimeRoot:${JSON.stringify(candidateRoot)},environment:{EVEJS_SOLO_PROGRESSION_BALANCE:'1'}})}catch(e){message=e.message}` +
    `delete Module._cache[target.filename];failures.push({key:target.key,message,clean:Module._load===before&&!globalThis[l.INSTALL_FLAG]&&!globalThis[Symbol.for(l.API_SYMBOL)]});}` +
    `console.log('RESULT:'+JSON.stringify(failures));`;
  const child = runNode(["-e", code], {
    env: { ...process.env, EVEJS_SOLO_PROGRESSION_BALANCE: "0" },
  });
  assert.strictEqual(child.status, 0, child.stderr || child.stdout);
  const failures = parseChildResult(child.stdout);
  assert.strictEqual(failures.length, 7);
  for (const failure of failures) {
    assert.match(failure.message, /required target already cached/u, failure.key);
    assert.strictEqual(failure.clean, true, failure.key);
  }
});

test("failed config and viability attempts leave activation retryable", () => {
  const code = `const Module=require('node:module');const before=Module._load;const l=require(${JSON.stringify(loaderPath)});` +
    `const invalid=l.install({environment:{EVEJS_SOLO_PROGRESSION_BALANCE:'1',EVEJS_SOLO_MINING_YIELD_SCALE:'0'}});` +
    `const missing=l.install({runtimeRoot:${JSON.stringify(path.join(candidateRoot, "missing-runtime"))},environment:{EVEJS_SOLO_PROGRESSION_BALANCE:'1'}});` +
    `const active=l.install({runtimeRoot:${JSON.stringify(candidateRoot)},environment:{EVEJS_SOLO_PROGRESSION_BALANCE:'1'}});const hooked=Module._load;const duplicate=l.install();` +
    `console.log('RESULT:'+JSON.stringify({invalid:invalid.reason,missing:missing.reason,active:active.active,duplicate:duplicate.reason,` +
    `hookChanged:hooked!==before,hookStable:Module._load===hooked,api:!!globalThis[Symbol.for(l.API_SYMBOL)]}));`;
  const child = runNode(["-e", code], {
    env: { ...process.env, EVEJS_SOLO_PROGRESSION_BALANCE: "0" },
  });
  assert.strictEqual(child.status, 0, child.stderr || child.stdout);
  const result = parseChildResult(child.stdout);
  assert.deepStrictEqual(result, {
    invalid: "invalid-config",
    missing: "not-viable",
    active: true,
    duplicate: "already-installed",
    hookChanged: true,
    hookStable: true,
    api: true,
  });
});

test("compile failure removes the transformed target from Module._cache", () => {
  const fixture = createSpaceRuntimeTransformFixture();
  const target = `${fixture.request}.js`;
  try {
    fs.appendFileSync(target, "\nconst = broken syntax;\n", "utf8");
    const loaded = transforms.loadTransformed(target, module);
    assert.strictEqual(loaded.ok, false);
    assert.match(loaded.reason, /compile failed/u);
    assert.strictEqual(Module._cache[target], undefined);
  } finally {
    delete Module._cache[target];
    fixture.cleanup();
  }
});

test("loader remains inactive in worker threads", () => {
  const code = `const {Worker}=require('node:worker_threads');` +
    `const w=new Worker("const {parentPort,workerData}=require('node:worker_threads');const l=require(workerData);parentPort.postMessage(l.installResult);",` +
    `{eval:true,workerData:${JSON.stringify(loaderPath)}});` +
    `w.once('message',(value)=>{console.log('RESULT:'+JSON.stringify(value));});w.once('error',(error)=>{throw error});`;
  const child = runNode(["-e", code], {
    env: { ...process.env, EVEJS_SOLO_PROGRESSION_BALANCE: "1" },
  });
  assert.strictEqual(child.status, 0, child.stderr || child.stdout);
  assert.deepStrictEqual(parseChildResult(child.stdout), { active: false, reason: "worker-thread" });
});

test("Solo-only preload activates", () => {
  const code = `const l=require(${JSON.stringify(loaderPath)});` +
    `const state=l.install({runtimeRoot:${JSON.stringify(candidateRoot)},environment:{EVEJS_SOLO_PROGRESSION_BALANCE:'1'}});` +
    `console.log('RESULT:'+JSON.stringify({active:state.active}));`;
  const child = runNode(["-e", code], {
    env: { ...process.env, EVEJS_SOLO_PROGRESSION_BALANCE: "0" },
  });
  assert.strictEqual(child.status, 0, child.stderr || child.stdout);
  assert.deepStrictEqual(parseChildResult(child.stdout), { active: true });
});

const fourModeLoader = path.join(candidateRoot, "mods/fourModeAsteroidBelts/loader.js");
if (fs.existsSync(fourModeLoader)) {
  test("Four-Mode-only preload activates", () => {
    const code = `const l=require(${JSON.stringify(fourModeLoader)});console.log('RESULT:'+JSON.stringify({active:l.active}));`;
    const child = runNode(["-e", code], {
      env: { ...process.env, EVEJS_SOLO_PROGRESSION_BALANCE: "0" },
    });
    assert.strictEqual(child.status, 0, child.stderr || child.stdout);
    assert.deepStrictEqual(parseChildResult(child.stdout), { active: true });
  });

  test("Solo and Four Mode hooks coexist in both preload orders", () => {
    for (const order of [[loaderPath, fourModeLoader], [fourModeLoader, loaderPath]]) {
      const code = `const Module=require('node:module');const first=require(${JSON.stringify(order[0])});` +
        `const firstHook=Module._load;const second=require(${JSON.stringify(order[1])});` +
        `const solo=${JSON.stringify(order[0])}===${JSON.stringify(loaderPath)}?first:second;` +
        `const belts=${JSON.stringify(order[0])}===${JSON.stringify(fourModeLoader)}?first:second;` +
        `const state=solo.install({runtimeRoot:${JSON.stringify(candidateRoot)},environment:{EVEJS_SOLO_PROGRESSION_BALANCE:'1'}});` +
        `console.log('RESULT:'+JSON.stringify({solo:state.active,belts:belts.active,` +
        `chain:state.hookState.previousLoad===belts.hookedLoad||belts.previousLoad===state.hookState.hookedLoad,outerChanged:Module._load!==firstHook}));`;
      const child = runNode(["-e", code], {
        env: { ...process.env, EVEJS_SOLO_PROGRESSION_BALANCE: "0" },
      });
      assert.strictEqual(child.status, 0, child.stderr || child.stdout);
      assert.deepStrictEqual(parseChildResult(child.stdout), {
        solo: true,
        belts: true,
        chain: true,
        outerChanged: true,
      });
    }
  });
} else {
  console.log("SKIP Four Mode preload integration (mod not installed in candidate EveJS root)");
}

console.log(`\n${results.length}/${results.length} PASS`);
