"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repositoryRoot = path.resolve(__dirname, "..");
const modRoot = path.join(repositoryRoot, "mods/skyhook-pi");
const evejsRoot = path.resolve(process.argv[2] || process.env.EVEJS_ROOT || "C:/projects/EveJS");
const compatibility = require(path.join(modRoot, "lib/compatibility"));
const { transform } = require(path.join(modRoot, "lib/orbitals"));
const { resolveInstallerID, planCollection } = require(path.join(modRoot, "lib/authority"));
const { createService } = require(path.join(modRoot, "lib/service"));
const delivery = require(path.join(modRoot, "lib/delivery"));

function read(relative, root = repositoryRoot) {
  return fs.readFileSync(path.join(root, ...relative.split("/")), "utf8");
}

function readJson(relative, root = repositoryRoot) {
  return JSON.parse(read(relative, root));
}

test("Skyhook PI 0.1.14 consistently targets EveJS 261018.1", () => {
  assert.equal(readJson("package.json", evejsRoot).version, "261018.1");
  assert.equal(readJson("server/package.json", evejsRoot).version, "261018.1");
  const manifest = readJson("mods/skyhook-pi/evejs-launcher.mod.json");
  assert.equal(manifest.version, "0.1.14");
  assert.deepEqual(manifest.compatibility.evejsVersions, ["261018.1"]);
  assert.equal(manifest.launcherApi.minLauncherVersion, "1.0.74");
  for (const [relative, marker] of [
    ["mods/skyhook-pi/loader.js", "0.1.14 loaded"],
    ["mods/skyhook-pi/lib/rpc.js", "version:'0.1.14'"],
    ["mods/skyhook-pi/client/companion.py", "Skyhook PI 0.1.14"],
    ["mods/skyhook-pi/README.md", "Skyhook PI 0.1.14"],
    ["release-notes/skyhook-pi-0.1.14.md", "Skyhook PI 0.1.14"],
  ]) assert.match(read(relative), new RegExp(marker.replaceAll(".", "\\."), "u"), relative);
});

test("Skyhook PI compatibility guard accepts the reviewed current Core", () => {
  const result = compatibility.inspectRoot(evejsRoot);
  assert.equal(result.compatible, true, result.errors.join("; "));
  assert.equal(result.version, "261018.1");
});

test("Skyhook PI current transforms apply and compile", () => {
  const files = {
    planet: "server/src/services/planet/planetOrbitalState.js",
    items: "server/src/services/inventory/itemStore.js",
    bootstrap: "server/bootstrap.js",
  };
  for (const [kind, relative] of Object.entries(files)) {
    const transformed = transform(kind, read(relative, evejsRoot));
    new vm.Script(`(function(require,module,exports,__dirname,__filename){${transformed}\n})`, { filename: relative });
    assert.equal((transformed.match(/\/\* skyhook-pi:v1 \*\//gu) || []).length, 1, kind);
  }
  assert.throws(() => transform("broker", ""), /UNKNOWN_TRANSFORM/u);
  assert.throws(() => transform("launch", ""), /UNKNOWN_TRANSFORM/u);
});

test("Skyhook PI planet transform wraps only the durable write lifecycle", () => {
  const transformed = transform("planet", read("server/src/services/planet/planetOrbitalState.js", evejsRoot));
  assert.doesNotMatch(read("mods/skyhook-pi/lib/orbitals.js"), /component_activate|Number\(record\.typeID\) !== 81080/u);
  const before = transformed.indexOf("?.beforeOrbitals(state)");
  const write = transformed.indexOf("database.write(TABLE_NAME");
  const after = transformed.indexOf("?.afterOrbitals(normalizedState)");
  const durable = transformed.indexOf("if (durable) resourcePersistencePending = false");
  assert.ok(before >= 0 && before < write, "beforeOrbitals must precede Core writes");
  assert.ok(after > durable, "afterOrbitals must run only after a durable Core write");
});

test("Skyhook PI installer privilege uses the matching native replacement intent", () => {
  const state = { replacementsByPlanet: { "4001": { launchedItemID: 9001, context: { characterID: 77, ownerID: 98000001 } } } };
  assert.equal(resolveInstallerID(state, { itemID: 9001, planetID: 4001 }, 98000001), 77);
  assert.equal(resolveInstallerID(state, { itemID: 9002, planetID: 4001 }, 98000001), 0);
  assert.equal(resolveInstallerID(state, { itemID: 9001, planetID: 4001 }, 98000002), 0,
    "a stale replacement intent must not grant installer rights after an ownership transfer");
  assert.equal(resolveInstallerID({ replacementsByPlanet: {} }, { itemID: 9001, planetID: 4001 }, 98000001), 0);
});

test("Skyhook PI authority uses public planet and native active/range contracts", () => {
  const source = read("mods/skyhook-pi/lib/authority.js");
  assert.doesNotMatch(source, /orbitals\._testing/u);
  assert.match(source, /world\.getCelestialByID/u);
  assert.match(source, /orbitals\.isCustomsInventoryOrbitalRecord/u);
  assert.match(source, /space\.getSceneForSession/u);
  assert.match(source, /getCommandTimeEntitySurfaceDistance/u);
});

test("Skyhook PI collects every stocked product from one skyhook in one request", () => {
  const producer = {
    itemID: 9001,
    planetID: 4001,
    solarSystemID: 3001,
    ownerCorpID: 98000001,
    installerID: 77,
    status: "paused",
    lastCycleMs: 1000,
    config: { amountPerCycle: 20, cycleMs: 300000, capacityPerProduct: 40320 },
    products: [
      { typeID: 2393, name: "Bacteria", volume: 0.38, quantity: 10 },
      { typeID: 2396, name: "Biofuels", volume: 0.38, quantity: 20 },
      { typeID: 3779, name: "Biomass", volume: 0.38, quantity: 0 },
    ],
  };
  let stored = structuredClone(producer);
  let pending = [];
  const requests = new Map();
  const receipts = new Set();
  let granted = null;
  const store = {
    transaction(fn) { return fn(); },
    get(id) { return id === stored.itemID ? structuredClone(stored) : null; },
    list() { return [structuredClone(stored)]; },
    save(row) { stored = structuredClone(row); },
    pending(id) { return pending.filter((row) => id === undefined || row.itemID === id).map((row) => structuredClone(row)); },
    reserve(row) { pending.push(structuredClone(row)); },
    finish(key) { pending = pending.filter((row) => row.receiptKey !== key); },
    request(characterID, requestID) { return requests.get(`${characterID}:${requestID}`) || null; },
    remember(characterID, requestID, payload, result) { requests.set(`${characterID}:${requestID}`, { payload, result: structuredClone(result) }); },
  };
  const anchor = { itemID: 9001, planetID: 4001, planetTypeID: 2016, solarSystemID: 3001, ownerCorpID: 98000001, active: true, destroyed: false };
  const authority = {
    identity() { return { characterID: 77, corpID: 98000001 }; },
    anchor() { return anchor; },
    manage() { return true; },
    collect(session, actualAnchor, products, flagID) {
      assert.equal(actualAnchor, anchor);
      assert.equal(flagID, 5);
      assert.deepEqual(products.map(({ typeID, quantity }) => ({ typeID, quantity })), [
        { typeID: 2393, quantity: 10 },
        { typeID: 2396, quantity: 20 },
      ]);
      return { ownerID: 77, shipID: 8001, flagID, products: products.map(({ typeID, quantity }) => ({ typeID, quantity })), quantity: 30 };
    },
    receipt(key) { return { success: true, found: receipts.has(key), durable: true }; },
    grant(reservation) { granted = structuredClone(reservation); receipts.add(reservation.receiptKey); return { data: { changes: [] } }; },
    notify() {},
  };
  const service = createService({ store, authority, catalogue: () => [], clock: () => 1000 });

  const result = service.collect({}, { action: "collect", itemID: 9001, flagID: 5, requestID: "collect-all-0001" });

  assert.equal(result.ok, true);
  assert.equal(result.code, "COLLECTED");
  assert.equal(result.quantity, 30);
  assert.deepEqual(granted.products, [{ typeID: 2393, quantity: 10 }, { typeID: 2396, quantity: 20 }]);
  assert.deepEqual(stored.products.map(({ typeID, quantity }) => ({ typeID, quantity })), [
    { typeID: 2393, quantity: 0 },
    { typeID: 2396, quantity: 0 },
    { typeID: 3779, quantity: 0 },
  ]);
  assert.equal(pending.length, 0);
});

test("Skyhook PI collection plan includes all products that fit and a partial final stack", () => {
  const products = [
    { typeID: 2393, quantity: 10 },
    { typeID: 2396, quantity: 20 },
    { typeID: 3779, quantity: 30 },
  ];
  const volumes = new Map([[2393, 0.5], [2396, 1], [3779, 2]]);

  assert.deepEqual(planCollection(products, (typeID) => volumes.get(typeID), 100), products);
  assert.deepEqual(planCollection(products, (typeID) => volumes.get(typeID), 30), [
    { typeID: 2393, quantity: 10 },
    { typeID: 2396, quantity: 20 },
    { typeID: 3779, quantity: 2 },
  ]);
});

test("Skyhook PI composes with an existing login payload above 256 KiB", () => {
  let state = 0x10293847;
  const denseBytes = Buffer.alloc(270000);
  for (let index = 0; index < denseBytes.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    denseBytes[index] = state & 0xff;
  }
  const existingExpression = Buffer.from(`'${denseBytes.toString("base64")}'`, "ascii");
  const header = Buffer.alloc(5);
  header[0] = 0x74;
  header.writeUInt32LE(existingExpression.length, 1);
  const existingEnvelope = Buffer.concat([header, existingExpression]);
  assert.ok(existingEnvelope.length > 256 * 1024);
  const combined = delivery.createDelivery(modRoot)(existingEnvelope);
  assert.equal(combined.readUInt32LE(1), combined.length - 5);
  assert.ok(combined.length <= 512 * 1024);
});

test("Skyhook PI rejects a combined login payload above 512 KiB", () => {
  let state = 0x89abcdef;
  const denseBytes = Buffer.alloc(400000);
  for (let index = 0; index < denseBytes.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    denseBytes[index] = state & 0xff;
  }
  const existingExpression = Buffer.from(`'${denseBytes.toString("base64")}'`, "ascii");
  const header = Buffer.alloc(5);
  header[0] = 0x74;
  header.writeUInt32LE(existingExpression.length, 1);
  assert.throws(
    () => delivery.createDelivery(modRoot)(Buffer.concat([header, existingExpression])),
    /Combined login payload is too large after compression .*max=524288/u,
  );
});
