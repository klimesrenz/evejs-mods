"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  normalizeManifest,
  createBeltTypePlan,
  summarizeManifest,
} = require(path.resolve(__dirname, "../../mods/tq-asteroid-belts/lib/manifest"));

const RAW_MANIFEST = {
  schemaVersion: 1,
  source: {
    clientBuild: 3396210,
    resourcePath: "res:/staticdata/asteroidcountbytypeidbeltid.static",
    sha256: "a".repeat(64),
  },
  belts: {
    "40000006": [[17471, 2], [1224, 3]],
    "40000003": [[1230, 1], [1228, 2]],
  },
  stats: {
    beltCount: 2,
    asteroidCount: 8,
    typeCount: 4,
    maximumBeltCount: 5,
    maximumBeltID: 40000006,
  },
};

test("normalizes a versioned per-belt manifest", () => {
  const manifest = normalizeManifest(RAW_MANIFEST);

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.source.clientBuild, 3396210);
  assert.deepEqual(manifest.belts.get(40000003), [
    { typeID: 1228, count: 2 },
    { typeID: 1230, count: 1 },
  ]);
  assert.deepEqual(summarizeManifest(manifest), {
    beltCount: 2,
    asteroidCount: 8,
    typeCount: 4,
    maximumBeltCount: 5,
    maximumBeltID: 40000006,
  });
});

test("creates a deterministic plan with exact type counts", () => {
  const manifest = normalizeManifest(RAW_MANIFEST);
  const first = createBeltTypePlan(manifest, 40000006);
  const second = createBeltTypePlan(manifest, 40000006);

  assert.deepEqual(first, second);
  assert.equal(first.length, 5);
  assert.deepEqual(
    Object.fromEntries(
      [...new Set(first)].sort((a, b) => a - b).map((typeID) => [
        typeID,
        first.filter((candidate) => candidate === typeID).length,
      ]),
    ),
    { 1224: 3, 17471: 2 },
  );
});

test("uses the manifest build in the shuffle seed", () => {
  const first = createBeltTypePlan(normalizeManifest(RAW_MANIFEST), 40000006);
  const changedBuild = structuredClone(RAW_MANIFEST);
  changedBuild.source.clientBuild += 1;
  const second = createBeltTypePlan(normalizeManifest(changedBuild), 40000006);

  assert.notDeepEqual(first, second);
});

test("returns null for a belt absent from the TQ manifest", () => {
  const manifest = normalizeManifest(RAW_MANIFEST);
  assert.equal(createBeltTypePlan(manifest, 49999999), null);
});

test("rejects duplicate type IDs and unsafe values", () => {
  const duplicate = structuredClone(RAW_MANIFEST);
  duplicate.belts["40000003"] = [[1230, 1], [1230, 2]];
  assert.throws(() => normalizeManifest(duplicate), /duplicate typeID/);

  const oversized = structuredClone(RAW_MANIFEST);
  oversized.belts["40000003"] = [[1230, 512]];
  assert.throws(() => normalizeManifest(oversized), /item-ID stride/);

  const boundary = structuredClone(RAW_MANIFEST);
  boundary.belts = { "40000003": [[1230, 511]] };
  boundary.stats = {
    beltCount: 1,
    asteroidCount: 511,
    typeCount: 1,
    maximumBeltCount: 511,
    maximumBeltID: 40000003,
  };
  assert.equal(createBeltTypePlan(normalizeManifest(boundary), 40000003).length, 511);
});

test("rejects coercible values and colliding non-canonical belt IDs", () => {
  const stringCount = structuredClone(RAW_MANIFEST);
  stringCount.belts["40000003"][0][1] = "1";
  assert.throws(() => normalizeManifest(stringCount), /must be a positive safe integer number/);

  const stringBuild = structuredClone(RAW_MANIFEST);
  stringBuild.source.clientBuild = "3396210";
  assert.throws(() => normalizeManifest(stringBuild), /must be a positive safe integer number/);

  const nonCanonical = structuredClone(RAW_MANIFEST);
  nonCanonical.belts["040000003"] = nonCanonical.belts["40000003"];
  assert.throws(() => normalizeManifest(nonCanonical), /canonical positive integer/);

  const unsafeItemID = structuredClone(RAW_MANIFEST);
  unsafeItemID.belts = { "9007199254740991": [[1230, 1]] };
  unsafeItemID.stats = {
    beltCount: 1,
    asteroidCount: 1,
    typeCount: 1,
    maximumBeltCount: 1,
    maximumBeltID: 9007199254740991,
  };
  assert.throws(() => normalizeManifest(unsafeItemID), /cannot produce safe EveJS asteroid item IDs/);
});

test("requires provenance and exact aggregate statistics", () => {
  const missingHash = structuredClone(RAW_MANIFEST);
  delete missingHash.source.sha256;
  assert.throws(() => normalizeManifest(missingHash), /source.sha256/);

  const missingStats = structuredClone(RAW_MANIFEST);
  delete missingStats.stats;
  assert.throws(() => normalizeManifest(missingStats), /manifest.stats/);

  const wrongStats = structuredClone(RAW_MANIFEST);
  wrongStats.stats.asteroidCount += 1;
  assert.throws(() => normalizeManifest(wrongStats), /stats mismatch for asteroidCount/);
});
