"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
// Private to DroneClassBalance and SoloProgressionBalance. Not a mod API.
const KEY = "evejs.ourMods.privateFittingRuntime";
const SUPPORTED_EVEJS_VERSION = "261018.1";
const HANDSHAKE_HASH = "c84cffe20c00cf075a97daa31ca53c435af4f14c814e46d828760dbbb55fb566";
const MAX_COMBINED_BYTES = 512 * 1024;
const hash = source => crypto.createHash("sha256").update(String(source).replace(/\r\n/g, "\n")).digest("hex");
function supportsSource(source) { return hash(source) === HANDSHAKE_HASH; }
function supportsRoot(root) {
  return JSON.parse(fs.readFileSync(path.join(root, "server/package.json"), "utf8")).version === SUPPORTED_EVEJS_VERSION &&
    supportsSource(fs.readFileSync(path.join(root, "server/src/network/tcp/handshake.js"), "utf8"));
}
function extendSource(source) {
  if (!supportsSource(source)) return null;
  // In-memory only. Retain the original login function and its return value.
  return source + `\n;const __fscOriginalLogin = buildTidiSignedFunc;
buildTidiSignedFunc = function() {
  const original = __fscOriginalLogin.apply(this, arguments);
  try { return globalThis[Symbol.for("${KEY}")]?.compose(original) || original; }
  catch (error) { console.error("[FittingSimulation] Delivery unavailable; native simulation retained."); return original; }
};\n`;
}
function readBundle(modRoot) {
  const adapter = fs.readFileSync(path.join(modRoot, "client/adapter.py"), "utf8");
  const bootstrap = fs.readFileSync(path.join(modRoot, "client/login.py"), "utf8");
  const fingerprints = JSON.parse(fs.readFileSync(path.join(modRoot, "client/compatibility.json"), "utf8"));
  const bundle = { abi: 1, revision: 2, families: ["droneclassbalance", "soloprogressionbalance"], wireSchema: 1, adapter, bootstrap, fingerprints };
  bundle.digest = bundleDigest(bundle);
  return bundle;
}
function bundleDigest(bundle) {
  return crypto.createHash("sha256").update(JSON.stringify([
    bundle.abi, bundle.revision, [...bundle.families].sort(), bundle.wireSchema,
    bundle.adapter, bundle.bootstrap, bundle.fingerprints,
  ])).digest("hex");
}
function createDelivery(bundle, policyProvider) {
  const source64 = zlib.deflateSync(Buffer.from(bundle.adapter, "utf8"), { level: 9 }).toString("base64");
  return function compose(original) {
    const policy = policyProvider();
    // Deliver even a null policy: a reconnect must dispose any old controller.
    if (!Buffer.isBuffer(original) || original.length < 5 || original[0] !== 0x74 || original.readUInt32LE(1) !== original.length - 5) return original;
    const policy64 = Buffer.from(JSON.stringify(policy), "utf8").toString("base64");
    const checks64 = Buffer.from(JSON.stringify(bundle.fingerprints), "utf8").toString("base64");
    const source = `_fsc_source64 = '${source64}'\n_fsc_policy64 = '${policy64}'\n_fsc_checks64 = '${checks64}'\n` + bundle.bootstrap;
    const encoded = Buffer.from(source, "utf8").toString("base64");
    const expression = `eval(compile(__import__('base64').b64decode('${encoded}'), '<fitting-simulation-login>', 'exec'), {'__builtins__': __builtins__, '_fsc_context': globals()})`;
    const wrapped = `(lambda _fsc_result: (${expression}, _fsc_result)[1])(${original.subarray(5).toString("ascii")})`;
    const data = Buffer.from(wrapped, "ascii");
    if (data.length > MAX_COMBINED_BYTES) return original;
    const header = Buffer.alloc(5); header[0] = 0x74; header.writeUInt32LE(data.length, 1);
    return Buffer.concat([header, data]);
  };
}
module.exports = {
  KEY,
  SUPPORTED_EVEJS_VERSION,
  HANDSHAKE_HASH,
  MAX_COMBINED_BYTES,
  supportsRoot,
  supportsSource,
  extendSource,
  readBundle,
  bundleDigest,
  createDelivery,
};
