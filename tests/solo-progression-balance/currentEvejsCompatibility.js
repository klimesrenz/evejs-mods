"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const modRoot = path.resolve(__dirname, "../../mods/solo-progression-balance");
const {createDelivery, readBundle, supportsRoot} = require(path.join(modRoot, "simulation/delivery"));
const {buildSoloPolicy} = require(path.join(modRoot, "simulation/policy"));
const {attachMember} = require(path.join(modRoot, "simulation/familyRuntime"));

const evejsRoot = path.resolve(process.env.EVEJS_ROOT || "C:/projects/EveJS");
const manifest = JSON.parse(fs.readFileSync(path.join(modRoot, "evejs-launcher.mod.json"), "utf8"));
const clientCompatibilityText = fs.readFileSync(path.join(modRoot, "simulation/client/compatibility.json"), "utf8");
assert.equal((clientCompatibilityText.match(/"minihangar\.CargoSlots\._Update"/gu) || []).length, 1);
JSON.parse(clientCompatibilityText);

assert.equal(manifest.version, "0.5.0");
assert.deepEqual(manifest.compatibility.evejsVersions, ["261018.1"]);
assert.equal(manifest.launcherApi.minLauncherVersion, "1.0.69");
assert.deepEqual(manifest.updates, {
  provider: "github",
  repository: "klimesrenz/evejs-mods",
  asset: "EveJS-SoloProgressionBalance-{version}.zip",
  channel: "stable",
  tagPrefix: "solo-progression-balance-v",
  preserveFiles: [],
});
console.log("PASS Launcher manifest publishes 0.5.0 for only EveJS 261018.1");

assert.equal(
  supportsRoot(evejsRoot),
  true,
  "current EveJS 261018.1 server and handshake must be accepted for simulation delivery",
);

console.log("PASS current EveJS 261018.1 simulation delivery compatibility");

const unsupportedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "solo-unsupported-evejs-"));
try {
  const unsupportedServer = path.join(unsupportedRoot, "server");
  const unsupportedHandshake = path.join(unsupportedServer, "src/network/tcp/handshake.js");
  fs.mkdirSync(path.dirname(unsupportedHandshake), {recursive: true});
  fs.writeFileSync(path.join(unsupportedServer, "package.json"), JSON.stringify({version: "0.12.9"}));
  fs.copyFileSync(path.join(evejsRoot, "server/src/network/tcp/handshake.js"), unsupportedHandshake);
  assert.equal(supportsRoot(unsupportedRoot), false, "an older EveJS version must fail closed");
  fs.writeFileSync(path.join(unsupportedServer, "package.json"), JSON.stringify({version: "261018.1"}));
  fs.appendFileSync(unsupportedHandshake, "\n// unreviewed handshake change\n");
  assert.equal(supportsRoot(unsupportedRoot), false, "an unknown handshake hash must fail closed");
} finally {
  fs.rmSync(unsupportedRoot, {recursive: true, force: true});
}
console.log("PASS unsupported EveJS version and handshake hash fail closed");

const policy = buildSoloPolicy(
  {active: true},
  {
    config: {
      enabled: true,
      miningYieldScale: 3,
      miningDroneYieldScale: 3,
      miningHoldScale: 3,
      logisticsCargoScale: 2,
    },
    getSpecialAttributeIDs: () => [],
    applyLogisticsCargoScale() {},
    applyMiningHoldScale() {},
  },
  [],
  () => false,
);
assert.equal(policy.evejs, "261018.1", "simulation policy must target the current EveJS release");
console.log("PASS current EveJS 261018.1 simulation policy envelope");

const existingExpression = `${"0 or ".repeat(70000)}0`;
const existingPayload = Buffer.from(existingExpression, "ascii");
const originalPacket = Buffer.alloc(5 + existingPayload.length);
originalPacket[0] = 0x74;
originalPacket.writeUInt32LE(existingPayload.length, 1);
existingPayload.copy(originalPacket, 5);
const packedPacket = createDelivery(readBundle(path.join(modRoot, "simulation")), () => policy)(originalPacket);
assert.notStrictEqual(
  packedPacket,
  originalPacket,
  "simulation delivery must compose with an existing login expression larger than 256 KiB",
);
assert.equal(packedPacket.readUInt32LE(1), packedPacket.length - 5);
assert.ok(packedPacket.length <= 512 * 1024, `combined packet unexpectedly large: ${packedPacket.length}`);
console.log(`PASS large login delivery composition (${originalPacket.length} -> ${packedPacket.length} bytes)`);

const oversizedPayload = Buffer.alloc(500 * 1024, 0x30);
const oversizedPacket = Buffer.alloc(5 + oversizedPayload.length);
oversizedPacket[0] = 0x74;
oversizedPacket.writeUInt32LE(oversizedPayload.length, 1);
oversizedPayload.copy(oversizedPacket, 5);
assert.strictEqual(
  createDelivery(readBundle(path.join(modRoot, "simulation")), () => policy)(oversizedPacket),
  oversizedPacket,
  "a combined payload over 512 KiB must fail closed to the previous login packet",
);
console.log("PASS fitting delivery retains the previous packet above the 512 KiB bound");

const bundle = readBundle(path.join(modRoot, "simulation"));
const autoMiningRoot = path.resolve(process.env.AUTOMINING_MOD_ROOT || path.join(evejsRoot, "mods/AutoMining"));
const autoMiningDeliveryPath = path.join(autoMiningRoot, "lib/loginDelivery.js");
if (fs.existsSync(autoMiningDeliveryPath)) {
  const nativePayload = Buffer.from("0", "ascii");
  const nativePacket = Buffer.alloc(5 + nativePayload.length);
  nativePacket[0] = 0x74;
  nativePacket.writeUInt32LE(nativePayload.length, 1);
  nativePayload.copy(nativePacket, 5);
  const autoMiningPacket = require(autoMiningDeliveryPath).createDelivery(autoMiningRoot).compose(nativePacket);
  const ecosystemPacket = createDelivery(bundle, () => policy)(autoMiningPacket);
  assert.ok(autoMiningPacket.length > nativePacket.length);
  assert.ok(ecosystemPacket.length > autoMiningPacket.length);
  assert.ok(ecosystemPacket.length <= 512 * 1024);
  assert.equal(ecosystemPacket.readUInt32LE(1), ecosystemPacket.length - 5);
  console.log(`PASS real AutoMining composer plus fitting delivery (${autoMiningPacket.length} -> ${ecosystemPacket.length} bytes)`);
} else {
  console.log("SKIP real AutoMining composer (set AUTOMINING_MOD_ROOT to require this integration)");
}

const autoMiningKey = Symbol.for("evejs.automining.loader.v1");
const fittingKey = Symbol.for("evejs.ourMods.privateFittingRuntime");
const member = {id: "soloprogressionbalance", bundle, eligible: () => true, policy: () => policy};
const handshakePath = path.join(evejsRoot, "server/src/network/tcp/handshake.js");
const handshakeSource = fs.readFileSync(handshakePath, "utf8");

for (const soloFirst of [false, true]) {
  const compiledSources = [];
  const moduleHost = {
    _cache: {},
    prototype: {
      _compile(source) {
        compiledSources.push(source);
        return source;
      },
    },
  };
  const host = {
    [autoMiningKey]: {
      active: true,
      delivery: {
        compose(packet) {
          return packet;
        },
      },
    },
  };
  const installAutoMiningHook = () => {
    const previousCompile = moduleHost.prototype._compile;
    moduleHost.prototype._compile = function autoMiningCompile(source, filename) {
      if (path.resolve(filename) === path.resolve(handshakePath)) source += "\n// AutoMining owns this source transform";
      return previousCompile.call(this, source, filename);
    };
  };
  let runtime;
  if (soloFirst) {
    runtime = attachMember(evejsRoot, member, host, moduleHost);
    installAutoMiningHook();
  } else {
    installAutoMiningHook();
    runtime = attachMember(evejsRoot, member, host, moduleHost);
  }
  moduleHost.prototype._compile(handshakeSource, handshakePath);
  assert.equal(
    compiledSources.at(-1),
    `${handshakeSource}\n// AutoMining owns this source transform`,
    "AutoMining must remain the only handshake source owner",
  );
  const sharedPacket = host[autoMiningKey].delivery.compose(originalPacket);
  assert.notStrictEqual(sharedPacket, originalPacket, "AutoMining delivery must feed the fitting simulation composer");
  assert.equal(runtime, host[fittingKey]);
}
console.log("PASS AutoMining and fitting simulation compose in both loader orders");

const throwingDelivery = {};
Object.defineProperty(throwingDelivery, "delivery", {get() { throw Error("unavailable delivery"); }});
const throwingCompose = {};
Object.defineProperty(throwingCompose, "compose", {get() { throw Error("unavailable composer"); }});
const incompatibleAutoMining = [
  {active: true},
  {active: true, delivery: Object.freeze({compose(packet) { return packet; }})},
  {active: true, delivery: Object.preventExtensions({compose(packet) { return packet; }})},
  {active: true, delivery: throwingCompose},
  throwingDelivery,
];
for (const autoMining of incompatibleAutoMining) {
  const unavailableSources = [];
  const unavailableModuleHost = {
    _cache: {},
    prototype: {
      _compile(source) {
        unavailableSources.push(source);
        return source;
      },
    },
  };
  const unavailableHost = {[autoMiningKey]: autoMining};
  const unavailableRuntime = attachMember(evejsRoot, member, unavailableHost, unavailableModuleHost);
  assert.doesNotThrow(() => unavailableModuleHost.prototype._compile(handshakeSource, handshakePath));
  assert.equal(unavailableSources.at(-1), handshakeSource);
  assert.equal(unavailableRuntime.transformed, false);
}
console.log("PASS incompatible and immutable AutoMining delivery objects fail closed");
