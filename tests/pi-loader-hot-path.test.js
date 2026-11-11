"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

for (const [name, modulePath] of [
  ["PI Processing", "../mods/pi-processing/lib/moduleTargetCache"],
  ["Skyhook PI", "../mods/skyhook-pi/lib/moduleTargetCache"],
]) {
  test(`${name} caches target classification by resolved filename`, () => {
    const { createModuleTargetCache } = require(modulePath);
    let canonicalizations = 0;
    const canonicalize = filename => {
      canonicalizations += 1;
      return filename.replace("/alias/", "/core/");
    };
    const classify = createModuleTargetCache(new Map([
      ["/core/target.js", "target"],
    ]), canonicalize);

    for (let index = 0; index < 1000; index += 1) {
      assert.equal(classify("/core/target.js"), "target");
      assert.equal(classify("/core/unrelated.js"), undefined);
    }
    assert.equal(canonicalizations, 2);

    assert.equal(classify("/alias/target.js"), "target");
    assert.equal(classify("/alias/target.js"), "target");
    assert.equal(canonicalizations, 3);
  });
}

for (const [name, loaderPath] of [
  ["PI Processing", "../mods/pi-processing/loader.js"],
  ["Skyhook PI", "../mods/skyhook-pi/loader.js"],
]) {
  test(`${name} routes loader target checks through the resolved-filename cache`, () => {
    const source = fs.readFileSync(path.resolve(__dirname, loaderPath), "utf8");
    assert.match(source, /createModuleTargetCache/);
    assert.match(source, /classifyTarget/);
    assert.doesNotMatch(source, /targets\.get\(canonical\(Module\._resolveFilename/);
    assert.doesNotMatch(source, /targets\.get\(canonical\(filename\)\)/);
  });
}

test("repeated requires stay bounded through the complete nested loader chain", () => {
  const pi = require("../mods/pi-processing/lib/moduleTargetCache");
  const skyhook = require("../mods/skyhook-pi/lib/moduleTargetCache");
  let piCanonicalizations = 0;
  let skyhookCanonicalizations = 0;
  const targets = new Map([["/core/target.js", "target"]]);
  const piClassify = pi.createModuleTargetCache(targets, filename => {
    piCanonicalizations += 1;
    return filename;
  });
  const skyhookClassify = skyhook.createModuleTargetCache(targets, filename => {
    skyhookCanonicalizations += 1;
    return filename;
  });
  const terminalLoad = filename => filename;
  const passthrough = next => filename => next(filename);
  const piLoader = next => filename => {
    piClassify(filename);
    return next(filename);
  };
  const skyhookLoader = next => filename => {
    skyhookClassify(filename);
    return next(filename);
  };
  const load = passthrough(passthrough(skyhookLoader(passthrough(piLoader(terminalLoad)))));

  for (let index = 0; index < 10000; index += 1) {
    assert.equal(load("/core/target.js"), "/core/target.js");
    assert.equal(load("/core/unrelated.js"), "/core/unrelated.js");
  }
  assert.equal(piCanonicalizations, 2);
  assert.equal(skyhookCanonicalizations, 2);
});

test("shared production hook registry supports both close orders and reinstall", () => {
  const pi = require("../mods/pi-processing/lib/moduleHookRegistry");
  const skyhook = require("../mods/skyhook-pi/lib/moduleHookRegistry");
  const originalLoad = Module._load;
  const calls = [];
  const first = pi.registerLoadHook(exports => {
    calls.push("pi");
    return exports;
  });
  const second = skyhook.registerLoadHook(exports => {
    calls.push("skyhook");
    return exports;
  });
  try {
    Module._load("node:path", module, false);
    assert.deepEqual(calls, ["pi", "skyhook"]);
    calls.length = 0;
    first();
    Module._load("node:path", module, false);
    assert.deepEqual(calls, ["skyhook"]);
    second();
    assert.equal(Module._load, originalLoad);

    const reinstalled = pi.registerLoadHook(exports => exports);
    assert.notEqual(Module._load, originalLoad);
    reinstalled();
    assert.equal(Module._load, originalLoad);
  } finally {
    first();
    second();
    if (Module._load !== originalLoad) Module._load = originalLoad;
  }
});

test("real PI loaders bound canonicalization across repeated require calls", t => {
  const coreRoot = path.resolve(process.env.EVEJS_ROOT || "C:/projects/EveJS");
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "pi-real-loaders-"));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const piReviewed = require("../mods/pi-processing/lib/reviewed.json");
  const skyReviewed = require("../mods/skyhook-pi/lib/reviewed.json");
  const files = new Set([
    "package.json",
    "server/package.json",
    "config/version.json",
    "server/index.js",
    ...Object.keys(piReviewed.files),
    ...Object.keys(skyReviewed.files),
  ]);
  for (const relative of files) {
    const source = path.join(coreRoot, ...relative.split("/"));
    const destination = path.join(fixture, ...relative.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  const unrelated = path.join(fixture, "unrelated.js");
  fs.writeFileSync(unrelated, "module.exports = {};\n");

  const oldPiAutoinstall = process.env.EVEJS_PI_PROCESSING_NO_AUTOINSTALL;
  const oldSkyAutoinstall = process.env.EVEJS_SKYHOOK_PI_NO_AUTOINSTALL;
  const oldEntry = process.argv[1];
  process.env.EVEJS_PI_PROCESSING_NO_AUTOINSTALL = "1";
  process.env.EVEJS_SKYHOOK_PI_NO_AUTOINSTALL = "1";
  const piLoader = require("../mods/pi-processing/loader");
  const skyLoader = require("../mods/skyhook-pi/loader");
  process.argv[1] = path.join(fixture, "server/index.js");
  const originalRealpath = fs.realpathSync;
  let canonicalizations = 0;
  fs.realpathSync = function(...args) {
    canonicalizations += 1;
    return originalRealpath.apply(this, args);
  };
  let piState;
  let skyState;
  try {
    piState = piLoader.install(fixture);
    skyState = skyLoader.install(fixture);
    canonicalizations = 0;
    require(unrelated);
    const firstRequireCanonicalizations = canonicalizations;
    assert.ok(firstRequireCanonicalizations <= 3, String(firstRequireCanonicalizations));
    for (let index = 1; index < 10000; index += 1) require(unrelated);
    assert.equal(canonicalizations, firstRequireCanonicalizations);
    piState.close();
    piState = null;
    require(unrelated);
    assert.equal(canonicalizations, firstRequireCanonicalizations);
    skyState.close();
    skyState = null;

    delete require.cache[unrelated];
    skyState = skyLoader.install(fixture);
    piState = piLoader.install(fixture);
    canonicalizations = 0;
    require(unrelated);
    const reverseFirstRequireCanonicalizations = canonicalizations;
    assert.ok(reverseFirstRequireCanonicalizations <= 3, String(reverseFirstRequireCanonicalizations));
    for (let index = 1; index < 10000; index += 1) require(unrelated);
    assert.equal(canonicalizations, reverseFirstRequireCanonicalizations);
    skyState.close();
    skyState = null;
    require(unrelated);
    assert.equal(canonicalizations, reverseFirstRequireCanonicalizations);
    piState.close();
    piState = null;
  } finally {
    if (piState) piState.close();
    if (skyState) skyState.close();
    fs.realpathSync = originalRealpath;
    process.argv[1] = oldEntry;
    if (oldPiAutoinstall === undefined) delete process.env.EVEJS_PI_PROCESSING_NO_AUTOINSTALL;
    else process.env.EVEJS_PI_PROCESSING_NO_AUTOINSTALL = oldPiAutoinstall;
    if (oldSkyAutoinstall === undefined) delete process.env.EVEJS_SKYHOOK_PI_NO_AUTOINSTALL;
    else process.env.EVEJS_SKYHOOK_PI_NO_AUTOINSTALL = oldSkyAutoinstall;
    delete require.cache[unrelated];
  }
});
