"use strict";

const ASTEROID_ITEM_ID_STRIDE = 512;
const STATIC_ASTEROID_ITEM_ID_BASE = 5_000_000_000_000;
const MAX_SAFE_BELT_ID = Math.floor(
  (Number.MAX_SAFE_INTEGER - STATIC_ASTEROID_ITEM_ID_BASE - (ASTEROID_ITEM_ID_STRIDE - 1)) /
  ASTEROID_ITEM_ID_STRIDE,
);
const RESOURCE_PATH = "res:/staticdata/asteroidcountbytypeidbeltid.static";
const STAT_KEYS = Object.freeze([
  "beltCount",
  "asteroidCount",
  "typeCount",
  "maximumBeltCount",
  "maximumBeltID",
]);

function toSafePositiveInteger(value, label) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer number`);
  }
  return value;
}

function parseCanonicalPositiveIntegerKey(value, label) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new TypeError(`${label} must be a canonical positive integer key`);
  }
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || String(numeric) !== value) {
    throw new TypeError(`${label} must be a canonical positive integer key`);
  }
  return numeric;
}

function hashSeed(text) {
  let hash = 0x811c9dc5;
  for (const character of String(text)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function createRng(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeManifest(raw) {
  if (!raw || typeof raw !== "object") throw new TypeError("manifest must be an object");
  if (raw.schemaVersion !== 1) throw new Error(`unsupported manifest schema: ${raw.schemaVersion}`);
  const source = raw.source && typeof raw.source === "object" ? raw.source : {};
  const clientBuild = toSafePositiveInteger(source.clientBuild, "source.clientBuild");
  if (source.resourcePath !== RESOURCE_PATH) {
    throw new Error(`source.resourcePath must equal ${RESOURCE_PATH}`);
  }
  if (typeof source.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(source.sha256)) {
    throw new Error("source.sha256 must be a lowercase 64-character SHA-256 digest");
  }
  if (!raw.belts || typeof raw.belts !== "object" || Array.isArray(raw.belts)) {
    throw new TypeError("manifest.belts must be an object");
  }
  if (!raw.stats || typeof raw.stats !== "object" || Array.isArray(raw.stats)) {
    throw new TypeError("manifest.stats must be an object");
  }

  const belts = new Map();
  for (const [rawBeltID, rawEntries] of Object.entries(raw.belts)) {
    const beltID = parseCanonicalPositiveIntegerKey(rawBeltID, "beltID");
    if (beltID > MAX_SAFE_BELT_ID) {
      throw new Error(`beltID ${beltID} cannot produce safe EveJS asteroid item IDs`);
    }
    if (belts.has(beltID)) throw new Error(`duplicate normalized beltID ${beltID}`);
    if (!Array.isArray(rawEntries) || rawEntries.length <= 0) {
      throw new TypeError(`belt ${beltID} must contain at least one type entry`);
    }
    const seenTypeIDs = new Set();
    let totalCount = 0;
    const entries = rawEntries.map((entry) => {
      if (!Array.isArray(entry) || entry.length !== 2) {
        throw new TypeError(`belt ${beltID} entry must be [typeID, count]`);
      }
      const typeID = toSafePositiveInteger(entry[0], `belt ${beltID} typeID`);
      const count = toSafePositiveInteger(entry[1], `belt ${beltID} type ${typeID} count`);
      if (seenTypeIDs.has(typeID)) throw new Error(`belt ${beltID} has duplicate typeID ${typeID}`);
      seenTypeIDs.add(typeID);
      totalCount += count;
      return Object.freeze({ typeID, count });
    }).sort((left, right) => left.typeID - right.typeID);
    if (totalCount >= ASTEROID_ITEM_ID_STRIDE) {
      throw new Error(`belt ${beltID} exceeds EveJS item-ID stride (${totalCount} >= ${ASTEROID_ITEM_ID_STRIDE})`);
    }
    belts.set(beltID, Object.freeze(entries));
  }

  const manifest = {
    schemaVersion: 1,
    source: Object.freeze({ ...source, clientBuild }),
    belts,
  };
  const actualStats = summarizeManifest(manifest);
  for (const key of STAT_KEYS) {
    const expected = toSafePositiveInteger(raw.stats[key], `manifest.stats.${key}`);
    if (expected !== actualStats[key]) {
      throw new Error(`manifest stats mismatch for ${key}: expected ${expected}, got ${actualStats[key]}`);
    }
  }
  return Object.freeze({ ...manifest, stats: Object.freeze(actualStats) });
}

function createBeltTypePlan(manifest, beltID) {
  if (!manifest || !(manifest.belts instanceof Map)) throw new TypeError("normalized manifest required");
  const safeBeltID = toSafePositiveInteger(beltID, "beltID");
  const entries = manifest.belts.get(safeBeltID);
  if (!entries) return null;

  const plan = [];
  for (const entry of entries) {
    for (let index = 0; index < entry.count; index += 1) plan.push(entry.typeID);
  }
  const rng = createRng(hashSeed(`${manifest.source.clientBuild}:${safeBeltID}:tq-asteroids`));
  for (let index = plan.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [plan[index], plan[swapIndex]] = [plan[swapIndex], plan[index]];
  }
  return Object.freeze(plan);
}

function summarizeManifest(manifest) {
  if (!manifest || !(manifest.belts instanceof Map)) throw new TypeError("normalized manifest required");
  let asteroidCount = 0;
  let typeCount = 0;
  let maximumBeltCount = 0;
  let maximumBeltID = 0;
  for (const [beltID, entries] of manifest.belts) {
    typeCount += entries.length;
    const beltCount = entries.reduce((total, entry) => total + entry.count, 0);
    asteroidCount += beltCount;
    if (beltCount > maximumBeltCount) {
      maximumBeltCount = beltCount;
      maximumBeltID = beltID;
    }
  }
  return { beltCount: manifest.belts.size, asteroidCount, typeCount, maximumBeltCount, maximumBeltID };
}

module.exports = {
  ASTEROID_ITEM_ID_STRIDE,
  STATIC_ASTEROID_ITEM_ID_BASE,
  MAX_SAFE_BELT_ID,
  normalizeManifest,
  createBeltTypePlan,
  summarizeManifest,
  _testing: Object.freeze({ hashSeed, createRng }),
};
