"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const modRoot = path.resolve(__dirname, "../../mods/solo-progression-balance");
const { createMiningBalance } = require(path.join(modRoot, "lib/miningBalance"));
const { mergeMiningDroneClientAttributeOverrides } = require(path.join(modRoot, "lib/clientSync"));
const { installDroneDogma } = require(path.join(modRoot, "lib/overlays"));
const transforms = require(path.join(modRoot, "lib/sourceTransforms"));

const runtimeRoot = path.resolve(process.argv[2] || process.env.EVEJS_ROOT || path.join(__dirname, "../../../EveJS"));
const runtimeFile = path.join(runtimeRoot, "server/src/services/drone/droneRuntime.js");
const source = fs.readFileSync(runtimeFile, "utf8");
const transformed = transforms.transformSource(runtimeFile, source);
assert.equal(transformed.ok, true, transformed.reason);

function functionScope(text, token) {
  const start = text.indexOf(token);
  assert.ok(start >= 0, `missing production function: ${token}`);
  const end = text.indexOf("\nfunction ", start + token.length);
  assert.ok(end > start, `missing following function: ${token}`);
  return text.slice(start, end);
}

// Run the actual transformed EveJS prime and cache-rebuild functions, with only
// their world/DB boundary dependencies replaced. The old source seam would
// merge the idle entity's previous 255 m3 into a newly resolved 102 m3 map.
const productionFunctions = [
  functionScope(transformed.source, "function emitDroneDogmaPrime("),
  functionScope(transformed.source, "function handleControllerDogmaCacheRebuilt("),
].join("\n");

function makeHarness(scale, firstAttributes) {
  const api = createMiningBalance({ miningDroneYieldScale: scale });
  const ship = { kind: "ship", itemID: 5001, ownerID: 90000001, session: null };
  const droneItem = {
    itemID: 7001, typeID: 10250, ownerID: 90000001, locationID: 30000142,
    flagID: 0, groupID: 100, categoryID: 18, launcherID: 5001,
  };
  const drone = {
    kind: "drone", ...droneItem, controllerID: 5001, controllerOwnerID: 90000001,
    passiveDerivedState: { attributes: { ...firstAttributes, 77: Number(firstAttributes[77] || 0) * scale } },
  };
  const notifications = [];
  const session = {
    characterID: 90000001,
    sendNotification(name, _target, args) {
      notifications.push({ name, attributes: { ...args[1].attributeOverrides } });
    },
  };
  ship.session = session;
  const scene = { getEntityByID: (id) => id === ship.itemID ? ship : id === drone.itemID ? drone : null };
  const stamps = new Map();
  let upstreamAttributes = { ...firstAttributes };
  let refreshHandler = null;
  const context = vm.createContext({
    DRONE_CATEGORY_ID: 18,
    toInt: (value, fallback = 0) => Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback,
    toNumber: (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback,
    normalizeDroneSessions: (sessions) => sessions,
    getInterestedDroneSessions: () => [session],
    findItemById: (id) => id === ship.itemID ? ship : id === drone.itemID ? droneItem : null,
    resolveDroneTooltipAttributes: () => ({ ...upstreamAttributes }),
    buildDogmaPrimeEntry: (_item, options) => ({ attributeOverrides: options.attributeOverrides }),
    buildDroneTooltipAttributeStamp: (attributes) => Object.keys(attributes || {})
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => `${key}:${attributes[key]}`).join("|"),
    getDroneTooltipLastSentStamp: (shipID, droneID) => stamps.get(`${shipID}:${droneID}`) || "",
    setDroneTooltipLastSentStamp: (shipID, droneID, stamp) => stamps.set(`${shipID}:${droneID}`, stamp),
    pruneDroneTooltipLastSentStamps: () => {},
    getRuntime: () => ({ getSceneForSession: () => scene }),
    listControlledDroneEntities: () => [drone],
    setControllerDogmaCacheRebuiltHandler: (handler) => { refreshHandler = handler; },
  });
  context[Symbol.for("evejs.soloProgressionBalance")] = api;
  vm.runInContext(productionFunctions, context, { filename: "transformed-droneRuntime.js" });
  assert.equal(typeof refreshHandler, "function");
  return {
    api, ship, drone, notifications,
    prime() { context.emitDroneDogmaPrime(drone, ship, [session], droneItem); },
    refresh(nextAttributes) {
      upstreamAttributes = { ...nextAttributes };
      refreshHandler(ship);
    },
  };
}

const original = { 54: 7250, 73: 60000, 77: 85, 160: 0.4375 };
const coreOn = { ...original, 77: 102 };
const legacy = mergeMiningDroneClientAttributeOverrides(coreOn, { ...original, 77: 255 });
assert.equal(legacy[77], 255, "previous prime would reuse stale launched-drone attribute 77");

const harness = makeHarness(3, original);
harness.prime();
assert.equal(harness.notifications.length, 1);
assert.equal(harness.notifications[0].attributes[77], 255);
harness.refresh(coreOn);
assert.equal(harness.notifications.length, 2);
assert.equal(harness.notifications[1].attributes[77], 306);
assert.equal(harness.notifications[1].attributes[73], 60000);
assert.equal(harness.notifications[1].attributes[54], 7250);
assert.equal(harness.notifications[1].attributes[160], 0.4375);
assert.equal(harness.drone.passiveDerivedState.attributes[77], 255, "refresh must not rely on stale idle-entity state");
harness.refresh(coreOn);
assert.equal(harness.notifications.length, 2, "unchanged controller state must not emit another prime");
harness.refresh(original);
assert.equal(harness.notifications.length, 3);
assert.equal(harness.notifications[2].attributes[77], 255, "completed shutdown removes Core yield");

const ice = makeHarness(3, { 73: 164000, 77: 1000, 54: 7250 });
ice.prime();
ice.refresh({ 73: 134500, 77: 1000, 54: 7250 });
assert.equal(ice.notifications[1].attributes[77], 3000);
assert.equal(ice.notifications[1].attributes[73], 134500, "live Ice duration is retained");

const nonMining = makeHarness(3, { 54: 7250, 73: 60000 });
nonMining.prime();
nonMining.refresh({ 54: 8000, 73: 60000 });
assert.equal(nonMining.notifications[1].attributes[77], undefined);
assert.equal(nonMining.notifications[1].attributes[54], 8000);

const vanillaScale = makeHarness(1, original);
vanillaScale.prime();
vanillaScale.refresh(coreOn);
assert.equal(vanillaScale.notifications[1].attributes[77], 102);

let authoritativeAmount = 85;
const upstreamSnapshot = { durationMs: 60000, miningAmountM3: authoritativeAmount };
const fakeDroneDogma = {
  resolveDroneOperationalAttributes: () => ({ ...original, 77: authoritativeAmount }),
  resolveDroneMiningSnapshot: () => ({ ...upstreamSnapshot, miningAmountM3: authoritativeAmount }),
};
assert.equal(installDroneDogma(fakeDroneDogma, harness.api), true);
assert.equal(fakeDroneDogma.resolveDroneMiningSnapshot(harness.drone, harness.ship).miningAmountM3, 255);
authoritativeAmount = 102;
assert.equal(fakeDroneDogma.resolveDroneMiningSnapshot(harness.drone, harness.ship).miningAmountM3, 306);
assert.equal(upstreamSnapshot.miningAmountM3, 85, "upstream cached snapshot remains unmodified");

console.log("PASS live Mining Drone refresh 85->255, 102->306, repeat, shutdown, Ice, non-mining, x1, authoritative snapshot");
