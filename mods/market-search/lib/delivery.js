"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
// The reviewed original/native login envelope used by AutoMining too. Source
// files are only read; no compiler hook and no client code.ccp patch is needed.
const HANDSHAKE_HASHES = new Set([
  "24a36b919dffb439d0030f25601655fa0402f196c6379064390870268e6b046f",
  "6305a9abe3e555ae845b0c9a27ed6d5bd08bba0e903eaf3789c3756b935fbbfd",
  "4fc3c37ec83c443c1497a3daba57d7157d05bbe55af3be2d5545b6162398ebc9",
]);
function validateRoot(root) {
  const source = fs.readFileSync(path.join(root, "server/src/network/tcp/handshake.js"), "utf8").replace(/\r\n/g, "\n");
  const hash = crypto.createHash("sha256").update(source).digest("hex");
  if (!HANDSHAKE_HASHES.has(hash)) throw Error(`Unreviewed handshake.js (${hash}); Market Search left inactive.`);
  for (const file of ["server/src/network/tcp/utils/marshal.js", "server/src/services/market/marketProxyService.js", "server/src/services/chat/chatCommands.js", "server/src/space/worldData.js"]) {
    if (!fs.statSync(path.join(root, file)).isFile()) throw Error(`Missing ${file}`);
  }
  return hash;
}
function createDelivery(modRoot) {
  const source = fs.readFileSync(path.join(modRoot, "client/companion.py"));
  const encoded = zlib.deflateSync(source).toString("base64");
  const expression = `eval(compile(__import__('zlib').decompress(__import__('base64').b64decode('${encoded}')), '<evejs-market-search>', 'exec'), {'__builtins__': __builtins__, '_ms_context': globals()})`;
  return function compose(original) {
    if (!Buffer.isBuffer(original) || original.length < 5 || original[0] !== 0x74 || original.readUInt32LE(1) !== original.length - 5) throw Error("Unexpected signedFunc envelope.");
    // Keep separate bounds for source work and the final marshaled expression.
    if (original.length - 5 > 2 * 1024 * 1024) throw Error("Combined login source is too large (max 2 MiB).");
    const previous = original.subarray(5).toString("ascii");
    let data = Buffer.from(`(lambda _ms_result: (${expression}, _ms_result)[1])(${previous})`, "ascii");
    if (data.length > 2 * 1024 * 1024) throw Error("Combined login source is too large (max 2 MiB).");
    if (data.length > 256 * 1024) {
      const sourceBytes = data.length;
      // Compile the same complete expression in eval mode, with the caller's
      // globals AND locals. Preserve its result, exceptions and execution order.
      const packed = zlib.deflateSync(data, { level: 9 }).toString("base64");
      data = Buffer.from(`eval(compile(__import__('zlib').decompress(__import__('base64').b64decode('${packed}')), '<evejs-packed-login>', 'eval'), globals(), locals())`, "ascii");
      if (data.length > 256 * 1024) throw Error(`Combined login payload is too large after compression (source=${sourceBytes}, packed=${data.length}, max=262144).`);
      console.log(`[MarketSearch] UI delivery packed: source=${sourceBytes} bytes, wire=${data.length} bytes`);
    }
    const header = Buffer.alloc(5); header[0] = 0x74; header.writeUInt32LE(data.length, 1);
    return Buffer.concat([header, data]);
  };
}
function installPacketHook(exports, compose) {
  const original = exports.encodePacket;
  if (typeof original !== "function") throw Error("encodePacket is unavailable.");
  exports.encodePacket = function(value, ...rest) {
    // Match CryptoServerHandshake, never ordinary game packets. Compose AFTER
    // buildTidiSignedFunc, including any AutoMining additions, in either order.
    const entries = value?.[3]?.entries;
    if (Array.isArray(value) && value.length === 4 && value[0] === "" &&
        Array.isArray(value[1]) && value[1].length === 2 && value[1][1] === false &&
        value[2]?.type === "dict" && value[3]?.type === "dict" && Array.isArray(entries) &&
        entries.some(pair => pair[0] === "challenge_responsehash") && entries.some(pair => pair[0] === "macho_version")) {
      try { value = [value[0], [compose(value[1][0]), false], value[2], value[3]]; }
      catch (error) { console.error(`[MarketSearch] UI delivery skipped: ${error.message}`); }
    }
    return original.call(this, value, ...rest);
  };
}
module.exports = { validateRoot, createDelivery, installPacketHook };
