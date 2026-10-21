"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "..");
const modRoot = path.join(repositoryRoot, "mods/market-search");
const evejsRoot = path.resolve(process.argv[2] || "C:/projects/EveJS");
const delivery = require(path.join(modRoot, "lib/delivery"));

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function readEvejs(relative) {
  return fs.readFileSync(path.join(evejsRoot, ...relative.split("/")), "utf8");
}

const manifest = readJson(path.join(modRoot, "evejs-launcher.mod.json"));
const evejsPackage = readJson(path.join(evejsRoot, "package.json"));
const serverPackage = readJson(path.join(evejsRoot, "server/package.json"));

assert.equal(evejsPackage.version, "261018.1");
assert.equal(serverPackage.version, "261018.1");
assert.equal(manifest.version, "0.1.6");
assert.equal(manifest.launcherApi.minLauncherVersion, "1.0.74");
assert.ok(manifest.compatibility.evejsVersions.includes("261018.1"));

for (const [relative, marker] of [
  ["mods/market-search/loader.js", "0.1.6"],
  ["mods/market-search/helper.js", "0.1.6"],
  ["mods/market-search/client/companion.py", "0.1.6"],
  ["mods/market-search/README.md", "Market Search 0.1.6"],
  ["release-notes/market-search-0.1.6.md", "Market Search 0.1.6"],
]) {
  assert.match(fs.readFileSync(path.join(repositoryRoot, relative), "utf8"), new RegExp(marker.replaceAll(".", "\\."), "u"), relative);
}

const reviewedHash = delivery.validateRoot(evejsRoot);
assert.equal(reviewedHash, "c84cffe20c00cf075a97daa31ca53c435af4f14c814e46d828760dbbb55fb566");

let state = 0x13579bdf;
const denseBytes = Buffer.alloc(270000);
for (let index = 0; index < denseBytes.length; index += 1) {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  denseBytes[index] = state & 0xff;
}
const existingExpression = Buffer.from(`'${denseBytes.toString("base64")}'`, "ascii");
const existingEnvelopeHeader = Buffer.alloc(5);
existingEnvelopeHeader[0] = 0x74;
existingEnvelopeHeader.writeUInt32LE(existingExpression.length, 1);
const existingEnvelope = Buffer.concat([existingEnvelopeHeader, existingExpression]);
assert.ok(existingEnvelope.length > 256 * 1024, "fixture must exceed the obsolete 256 KiB limit");
const combinedEnvelope = delivery.createDelivery(modRoot)(existingEnvelope);
assert.equal(combinedEnvelope[0], 0x74);
assert.equal(combinedEnvelope.readUInt32LE(1), combinedEnvelope.length - 5);
assert.ok(combinedEnvelope.length <= 512 * 1024, "combined login expression must stay within 512 KiB");

const sourceContracts = [
  ["server/src/network/tcp/utils/marshal.js", /function encodePacket\(value\)/u],
  ["server/src/services/market/marketProxyService.js", /class MarketProxyService extends BaseService/u],
  ["server/src/services/market/marketProxyService.js", /async Handle_GetOrders\(args, session\)/u],
  ["server/src/services/chat/chatCommands.js", /function executeChatCommand\(session, rawMessage, chatHub, options = \{\}\)/u],
  ["server/src/_secondary/chat/chatRuntime.js", /function broadcastLocalMessage\(session, message\)/u],
  ["server/src/_secondary/chat/chatRuntime.js", /function sendChannelMessage\(session, roomName, message, options = \{\}\)/u],
  ["server/src/space/worldData.js", /function getSolarSystems\(/u],
  ["server/src/space/worldData.js", /function getStargatesForSystem\(/u],
];
for (const [relative, pattern] of sourceContracts) {
  assert.match(readEvejs(relative), pattern, relative);
}

let encoded = null;
const marshal = {
  encodePacket(value) {
    encoded = value;
    return value;
  },
};
delivery.installPacketHook(marshal, original => Buffer.concat([original, Buffer.from("-market-search")]));
const original = Buffer.from([0x74, 0x01, 0x00, 0x00, 0x00, 0x78]);
const handshake = [
  "",
  [original, false],
  { type: "dict", entries: [] },
  { type: "dict", entries: [["challenge_responsehash", "55087"], ["macho_version", 1]] },
];
marshal.encodePacket(handshake);
assert.equal(encoded[1][0].subarray(-14).toString("ascii"), "-market-search");
assert.equal(handshake[1][0], original, "the hook must not mutate the caller's handshake tuple");

console.log("PASS Market Search compatibility contracts for EveJS 261018.1");
