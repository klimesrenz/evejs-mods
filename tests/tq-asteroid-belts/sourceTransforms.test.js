"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const transforms = require(path.resolve(__dirname, "../../mods/tq-asteroid-belts/lib/sourceTransforms"));

const evejsRoot = process.env.EVEJS_TEST_ROOT || "C:/projects/EveJS";
const targetPath = path.join(evejsRoot, "server/src/space/asteroids/asteroidService.js");

function readTarget() {
  return fs.readFileSync(targetPath, "utf8");
}

function newlineFor(source) {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

test("transforms the owned asteroid population seam and compiles", () => {
  const transformed = transforms.transformAsteroidService(readTarget());
  new Function("require", "module", "exports", "__filename", "__dirname", transformed);
  assert.match(transformed, /TQ_ASTEROID_BELTS_TRANSFORM/);
  assert.match(transformed, /createBeltTypePlan/);
  assert.match(transformed, /generatedFromTqManifest/);
});

test("preserves unrelated source edits", () => {
  const source = readTarget();
  const newline = newlineFor(source);
  const suffix = `${newline}// unrelated source edit${newline}`;
  assert.ok(transforms.transformAsteroidService(source + suffix).endsWith(suffix));
});

test("fails closed for repeat and FourMode transformations", () => {
  const source = readTarget();
  const newline = newlineFor(source);
  const transformed = transforms.transformAsteroidService(source);
  assert.throws(() => transforms.transformAsteroidService(transformed), /already installed/);
  assert.throws(
    () => transforms.transformAsteroidService(source.replace(
      'const path = require("path");',
      `const path = require("path");${newline}/* FOUR_MODE_ASTEROID_TRANSFORM:conflict */`,
    )),
    /FourMode conflict/,
  );
});

test("fails closed when the owned population seam changes", () => {
  const changed = readTarget().replace(
    "  const totalCount = Math.max(0, toPositiveInt(fieldProfile.count, 0));",
    "  const totalCount = Math.max(0, toPositiveInt(fieldProfile.count, 0)); // changed",
  );
  assert.throws(() => transforms.transformAsteroidService(changed), /semantic seam changed/);
});
