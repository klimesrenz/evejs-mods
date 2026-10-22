"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const zlib = require("node:zlib");
const {
  normalizeManifest,
  createBeltTypePlan,
  summarizeManifest,
} = require("./manifest");
const { parseJsonRejectDuplicateKeys } = require("./strictJson");

const DEFAULT_MANIFEST_PATH = path.join(__dirname, "../data/asteroid-counts.json.gz");
const PINNED_CLIENT_BUILD = 3632936;
const PINNED_RESOURCE_SHA256 = "74f806cf931de135e2ef4fe1ad2edd2795948bafb4438b815320fb2f8990f520";
const PINNED_MANIFEST_SHA256 = "724c44edf514569524d5c652750cf331909c0899d53da570637d076a96b01d9b";

function parsePinnedManifestJson(json) {
  const bytes = Buffer.isBuffer(json) ? json : Buffer.from(json);
  const actualHash = crypto.createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== PINNED_MANIFEST_SHA256) {
    throw new Error("decompressed manifest SHA-256 does not match the pinned TQ manifest");
  }
  const manifest = normalizeManifest(parseJsonRejectDuplicateKeys(bytes.toString("utf8")));
  if (manifest.source.clientBuild !== PINNED_CLIENT_BUILD) {
    throw new Error(`manifest client build is not pinned to ${PINNED_CLIENT_BUILD}`);
  }
  if (manifest.source.sha256 !== PINNED_RESOURCE_SHA256) {
    throw new Error("manifest resource SHA-256 does not match the pinned TQ resource");
  }
  return manifest;
}

function loadManifestFile(filename = DEFAULT_MANIFEST_PATH) {
  const resolved = path.resolve(filename);
  const encoded = fs.readFileSync(resolved);
  const json = resolved.endsWith(".gz") ? zlib.gunzipSync(encoded) : encoded;
  return parsePinnedManifestJson(json);
}

function createApi(options = {}) {
  const manifest = options.manifest || loadManifestFile(options.manifestPath);
  const summary = Object.freeze(summarizeManifest(manifest));
  return Object.freeze({
    version: "0.1.0",
    source: manifest.source,
    summary,
    createBeltTypePlan(beltID) {
      return createBeltTypePlan(manifest, beltID);
    },
  });
}

module.exports = {
  DEFAULT_MANIFEST_PATH,
  PINNED_CLIENT_BUILD,
  PINNED_RESOURCE_SHA256,
  PINNED_MANIFEST_SHA256,
  parsePinnedManifestJson,
  loadManifestFile,
  createApi,
};
