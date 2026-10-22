"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const zlib = require("node:zlib");

const modRoot = path.resolve(__dirname, "../../mods/tq-asteroid-belts");
const { createApi, loadManifestFile, parsePinnedManifestJson } = require(path.join(modRoot, "lib/api"));
const { summarizeManifest } = require(path.join(modRoot, "lib/manifest"));
const { parseJsonRejectDuplicateKeys } = require(path.join(modRoot, "lib/strictJson"));

const manifestPath = path.join(modRoot, "data/asteroid-counts.json.gz");

test("loads the pinned TQ client manifest", () => {
  const manifest = loadManifestFile(manifestPath);
  assert.equal(manifest.source.clientBuild, 3632936);
  assert.equal(manifest.source.resourcePath, "res:/staticdata/asteroidcountbytypeidbeltid.static");
  assert.equal(manifest.source.sha256, "74f806cf931de135e2ef4fe1ad2edd2795948bafb4438b815320fb2f8990f520");
  assert.deepEqual(summarizeManifest(manifest), {
    beltCount: 40928,
    asteroidCount: 2123854,
    typeCount: 249314,
    maximumBeltCount: 186,
    maximumBeltID: 40161349,
  });
});

test("API returns immutable exact belt plans", () => {
  const api = createApi({ manifestPath });
  const plan = api.createBeltTypePlan(40009129);
  assert.equal(plan.length, 72);
  assert.equal(Object.isFrozen(plan), true);
  assert.deepEqual(
    [...new Set(plan)].sort((a, b) => a - b),
    [1228, 1230, 17463, 17464, 17470, 17471],
  );
  assert.equal(api.createBeltTypePlan(49999999), null);
});

test("JSON parser rejects duplicate object keys at every depth", () => {
  assert.throws(
    () => parseJsonRejectDuplicateKeys('{"schemaVersion":1,"schemaVersion":1}'),
    /duplicate JSON key.*schemaVersion/,
  );
  assert.throws(
    () => parseJsonRejectDuplicateKeys('{"source":{"sha256":"a","sha256":"b"}}'),
    /duplicate JSON key.*sha256/,
  );
});

test("pinned manifest hash rejects count swaps that preserve aggregate stats", () => {
  const original = zlib.gunzipSync(fs.readFileSync(manifestPath)).toString("utf8");
  const modified = original.replace(
    '"40009129":[[1228,21],[1230,25]',
    '"40009129":[[1228,22],[1230,24]',
  );
  assert.notEqual(modified, original);
  assert.throws(
    () => parsePinnedManifestJson(Buffer.from(modified)),
    /decompressed manifest SHA-256/,
  );
});
