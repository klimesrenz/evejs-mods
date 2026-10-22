"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const transforms = require("./sourceTransforms");

const PREIMAGE = Object.freeze({
  relative: "server/src/space/asteroids/asteroidService.js",
  sha256: "81b2fe80b55f67fb263120ef7cca63de1a2d5ba23a25a293afc8a29ca8294795",
});

function hash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function canonicalize(filename, options = {}) {
  const platform = options.platform || process.platform;
  const resolved = path.resolve(filename);
  const realpath = options.realpath || (fs.realpathSync.native || fs.realpathSync);
  let canonical;
  try {
    canonical = realpath(resolved);
  } catch (_error) {
    canonical = resolved;
  }
  if (platform === "win32") {
    return path.win32.normalize(canonical.replace(/\//g, "\\")).toLowerCase();
  }
  return path.posix.normalize(canonical.replace(/\\/g, "/"));
}

function run(runtimeRoot) {
  const filename = path.resolve(runtimeRoot, PREIMAGE.relative);
  if (!fs.existsSync(filename)) throw new Error(`TQ_ASTEROID_BELTS_TARGET_MISSING:${PREIMAGE.relative}`);
  const raw = fs.readFileSync(filename);
  const source = raw.toString("utf8");
  transforms.validateAsteroidService(source);
  const canonical = canonicalize(filename);
  const cachedCanonical = new Set(Object.keys(Module._cache).map((candidate) => canonicalize(candidate)));
  if (cachedCanonical.has(canonical)) throw new Error(`TQ_ASTEROID_BELTS_TARGET_PRE_CACHED:${filename}`);
  return Object.freeze({
    filename,
    canonical,
    source,
    sha256: hash(raw),
    knownCleanSha256: PREIMAGE.sha256,
    matchesKnownCleanSource: hash(raw) === PREIMAGE.sha256,
  });
}

module.exports = { PREIMAGE, hash, canonicalize, run };
