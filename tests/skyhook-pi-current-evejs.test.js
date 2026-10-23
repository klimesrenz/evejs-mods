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
const { resolveInstallerID } = require(path.join(modRoot, "lib/authority"));
const delivery = require(path.join(modRoot, "lib/delivery"));

function read(relative, root = repositoryRoot) {
  return fs.readFileSync(path.join(root, ...relative.split("/")), "utf8");
}

function readJson(relative, root = repositoryRoot) {
  return JSON.parse(read(relative, root));
}

test("Skyhook PI 0.1.13 consistently targets EveJS 261018.1", () => {
  assert.equal(readJson("package.json", evejsRoot).version, "261018.1");
  assert.equal(readJson("server/package.json", evejsRoot).version, "261018.1");
  const manifest = readJson("mods/skyhook-pi/evejs-launcher.mod.json");
  assert.equal(manifest.version, "0.1.13");
  assert.deepEqual(manifest.compatibility.evejsVersions, ["261018.1"]);
  assert.equal(manifest.launcherApi.minLauncherVersion, "1.0.74");
  for (const [relative, marker] of [
    ["mods/skyhook-pi/loader.js", "0.1.13 loaded"],
    ["mods/skyhook-pi/lib/rpc.js", "version:'0.1.13'"],
    ["mods/skyhook-pi/client/companion.py", "Skyhook PI 0.1.13"],
    ["mods/skyhook-pi/README.md", "Skyhook PI 0.1.13"],
    ["release-notes/skyhook-pi-0.1.13.md", "Skyhook PI 0.1.13"],
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
