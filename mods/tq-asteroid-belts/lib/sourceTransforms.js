"use strict";

const crypto = require("node:crypto");

const API_SYMBOL = "evejs.tqAsteroidBelts";
const TRANSFORM_MARKER = "/* TQ_ASTEROID_BELTS_TRANSFORM:0.12.9 */";
const POPULATE_SEAM_SHA256 = "82f366d56d3b41f0e4d1cd58aa55abaed1469ebd9ecc352f3baba1f74f5335a8";

function hashText(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function count(source, needle) {
  let result = 0;
  let offset = 0;
  while ((offset = source.indexOf(needle, offset)) >= 0) {
    result += 1;
    offset += needle.length;
  }
  return result;
}

function uniqueIndex(source, needle, label) {
  const matches = count(source, needle);
  if (matches === 0) throw new Error(`${label}: required semantic anchor missing`);
  if (matches !== 1) throw new Error(`${label}: semantic anchor is ambiguous (${matches} matches)`);
  return source.indexOf(needle);
}

function replaceUnique(source, search, replacement, label) {
  const index = uniqueIndex(source, search, label);
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

function replaceOwnedRange(source, start, end, replacement, expectedSha256, label) {
  const startIndex = uniqueIndex(source, start, `${label} start`);
  const endIndex = uniqueIndex(source, end, `${label} end`);
  if (endIndex <= startIndex) throw new Error(`${label}: semantic range order is invalid`);
  const actualSha256 = hashText(source.slice(startIndex, endIndex));
  if (actualSha256 !== expectedSha256) {
    throw new Error(`${label}: semantic seam changed incompatibly (${actualSha256})`);
  }
  return `${source.slice(0, startIndex)}${replacement}${source.slice(endIndex)}`;
}

function withPreservedNewlines(source, transform) {
  if (typeof source !== "string") throw new TypeError("asteroid service source must be a string");
  const withoutCrLf = source.replace(/\r\n/g, "");
  if (withoutCrLf.includes("\r")) throw new Error("unsupported carriage-return newline style");
  const usesCrLf = source.includes("\r\n");
  if (usesCrLf && withoutCrLf.includes("\n")) throw new Error("mixed newline styles are unsafe");
  const normalized = usesCrLf ? source.replace(/\r\n/g, "\n") : source;
  const output = transform(normalized);
  return usesCrLf ? output.replace(/\n/g, "\r\n") : output;
}

const TQ_POPULATE = `function populateBeltField(scene, belt) {
  const style = asteroidData.getFieldStyleByID(belt.fieldStyleID);
  if (!scene || !belt) {
    return [];
  }

  const tqTypePlan = tqAsteroidBeltsApi.createBeltTypePlan(belt.itemID);
  const systemBelts = asteroidData.getBeltsForSystem(scene.systemID);
  const nativeFieldProfile = buildCurvedFieldProfile(scene, belt, style, systemBelts);
  const totalCount = tqTypePlan
    ? tqTypePlan.length
    : Math.max(0, toPositiveInt(nativeFieldProfile.count, 0));
  if (totalCount <= 0) {
    return [];
  }
  const fieldProfile = tqTypePlan
    ? { ...nativeFieldProfile, count: totalCount, authoredCount: totalCount }
    : nativeFieldProfile;

  const rng = createRng(toPositiveInt(belt.fieldSeed, belt.itemID));
  let enriched;
  let systemOrePool;
  let beltSubset;
  let tqRowsByTypeID = null;
  if (tqTypePlan) {
    const metadata = getSecurityMetadata(scene.systemID);
    enriched = { ...metadata, orePool: [] };
    tqRowsByTypeID = new Map();
    for (const typeID of new Set(tqTypePlan)) {
      const row = resolveItemByTypeID(typeID);
      const classification = classifyMiningMaterialType(row);
      if (!row || !classification || classification.kind !== "ore") {
        throw new Error(\`TQ_ASTEROID_TYPE_UNAVAILABLE:\${belt.itemID}:\${typeID}\`);
      }
      tqRowsByTypeID.set(typeID, row);
    }
    systemOrePool = Array.from(tqRowsByTypeID.values());
    beltSubset = systemOrePool;
  } else {
    enriched = buildEnrichedSystemOrePool(scene.systemID);
    systemOrePool = enriched.orePool;
    beltSubset = buildBeltOreSubset(systemOrePool, enriched.securityClass, rng);
  }
  const legacyClusterOffsets = [];

  const spawned = [];
  for (let asteroidIndex = 0; asteroidIndex < totalCount; asteroidIndex += 1) {
    const asteroidPool = tqTypePlan
      ? [tqRowsByTypeID.get(tqTypePlan[asteroidIndex])]
      : beltSubset;
    const entity = asteroidPool.length > 0
      ? buildSystemOreAsteroidEntity(
        scene,
        belt,
        asteroidIndex,
        totalCount,
        fieldProfile,
        rng,
        asteroidPool,
      )
      : buildDecorativeFallbackAsteroidEntity(
        belt,
        style,
        asteroidIndex,
        legacyClusterOffsets,
        rng,
      );
    if (!entity) {
      continue;
    }
    if (tqTypePlan) {
      entity.generatedFromTqManifest = true;
      entity.generatedFromSystemIDTable = false;
      entity.resourceFieldSource = "tqManifest";
      entity.tqManifestClientBuild = tqAsteroidBeltsApi.source.clientBuild;
    }
    if (scene.addStaticEntity(entity)) {
      spawned.push(entity);
    }
  }

  recordAsteroidBootstrap(scene, {
    beltID: toPositiveInt(belt && belt.itemID, 0),
    spawnedCount: spawned.length,
    orePool: systemOrePool,
    beltSubset,
    fieldProfile: {
      count: fieldProfile.count,
      authoredCount: fieldProfile.authoredCount,
      multiBeltOrbit: fieldProfile.multiBeltOrbit,
      axisSpanMeters: fieldProfile.axisSpanMeters,
      ribbonWidthMeters: fieldProfile.ribbonWidthMeters,
      visualRibbonWidthMeters: fieldProfile.visualRibbonWidthMeters,
      bowMeters: fieldProfile.bowMeters,
      laneCount: fieldProfile.laneCount,
      sideOffsetMeters: fieldProfile.sideOffsetMeters,
    },
    securityClass: enriched.securityClass,
    securityStatus: enriched.securityStatus,
  });

  return spawned;
}

`;

function transformAsteroidService(source) {
  return withPreservedNewlines(source, (incoming) => {
    if (incoming.includes(TRANSFORM_MARKER) || incoming.includes(`Symbol.for("${API_SYMBOL}")`)) {
      throw new Error("asteroid service transform is already installed");
    }
    if (incoming.includes("FOUR_MODE_ASTEROID_TRANSFORM") || incoming.includes("evejs.fourModeAsteroidBelts")) {
      throw new Error("asteroid service transform has a FourMode conflict");
    }
    let output = replaceUnique(
      incoming,
      'const path = require("path");',
      `const path = require("path");\n${TRANSFORM_MARKER}\nconst tqAsteroidBeltsApi = globalThis[Symbol.for("${API_SYMBOL}")];\nif (!tqAsteroidBeltsApi) throw new Error("TQ_ASTEROID_BELTS_API_MISSING");`,
      "TQ asteroid API",
    );
    output = replaceOwnedRange(
      output,
      "function populateBeltField",
      "function listGeneratedAsteroidEntities",
      TQ_POPULATE,
      POPULATE_SEAM_SHA256,
      "asteroid population",
    );
    return output;
  });
}

function validateAsteroidService(source) {
  transformAsteroidService(source);
  return true;
}

module.exports = {
  API_SYMBOL,
  TRANSFORM_MARKER,
  POPULATE_SEAM_SHA256,
  hashText,
  transformAsteroidService,
  validateAsteroidService,
};
