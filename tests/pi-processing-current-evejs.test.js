"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repositoryRoot = path.resolve(__dirname, "..");
const modRoot = path.join(repositoryRoot, "mods/pi-processing");
const evejsRoot = path.resolve(process.argv[2] || process.env.EVEJS_ROOT || "C:/projects/EveJS");
const compatibility = require(path.join(modRoot, "lib/compatibility"));
const { transformItems, classifyReceipt } = require(path.join(modRoot, "lib/inventory"));

function read(relative, root = repositoryRoot) {
  return fs.readFileSync(path.join(root, ...relative.split("/")), "utf8");
}

function readJson(relative, root = repositoryRoot) {
  return JSON.parse(read(relative, root));
}

test("PI Processing 0.1.3 consistently targets EveJS 261018.1", () => {
  assert.equal(readJson("package.json", evejsRoot).version, "261018.1");
  assert.equal(readJson("server/package.json", evejsRoot).version, "261018.1");
  const manifest = readJson("mods/pi-processing/evejs-launcher.mod.json");
  assert.equal(manifest.version, "0.1.3");
  assert.deepEqual(manifest.compatibility.evejsVersions, ["261018.1"]);
  assert.equal(manifest.launcherApi.minLauncherVersion, "1.0.74");
  for (const [relative, marker] of [
    ["mods/pi-processing/loader.js", "0.1.3 loaded"],
    ["mods/pi-processing/lib/rpc.js", "version:'0.1.3'"],
    ["mods/pi-processing/client/companion.py", "Переработка PI 0.1.3"],
    ["mods/pi-processing/README.md", "Переработка PI 0.1.3"],
    ["release-notes/pi-processing-0.1.3.md", "PI Processing 0.1.3"],
  ]) assert.match(read(relative), new RegExp(marker.replaceAll(".", "\\."), "u"), relative);
});

test("PI Processing compatibility guard accepts the reviewed current Core", () => {
  const result = compatibility.inspectRoot(evejsRoot);
  assert.equal(result.compatible, true, result.errors.join("; "));
  assert.equal(result.version, "261018.1");
});

test("PI Processing transform applies to current itemStore and compiles", () => {
  const source = read("server/src/services/inventory/itemStore.js", evejsRoot);
  const transformed = transformItems(source);
  new vm.Script(`(function(require,module,exports,__dirname,__filename){${transformed}\n})`, { filename: "itemStore.js" });
  assert.equal((transformed.match(/\/\* pi-processing:items \*\//gu) || []).length, 1);
  assert.match(transformed, /module\.exports\.piProcessingConsume/u);
  assert.throws(() => transformItems(transformed), /ALREADY_TRANSFORMED/u);
});

test("PI Processing distinguishes a durable absent receipt from uncertainty", () => {
  assert.deepEqual(classifyReceipt({ success: false }), { state: "uncertain" });
  assert.deepEqual(classifyReceipt({ success: true, found: false, durable: false }), { state: "absent" });
  assert.deepEqual(classifyReceipt({ success: true, found: true, durable: false }), { state: "uncertain" });
  const data = { fingerprint: { ownerID: 7 } };
  assert.deepEqual(classifyReceipt({ success: true, found: true, durable: true, data }), { state: "completed", receipt: data });
});

test("PI Processing uses canonical Core session identity", () => {
  assert.match(read("mods/pi-processing/lib/authority.js"), /resolveSessionCharacterID/u);
  assert.match(read("mods/pi-processing/lib/rpc.js"), /resolveSessionCharacterID/u);
});
