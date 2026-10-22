"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { isMainThread } = require("node:worker_threads");
const { createApi } = require("./lib/api");
const transforms = require("./lib/sourceTransforms");
const viability = require("./lib/viability");

const INSTALL_MARKER = Symbol.for("evejs.tqAsteroidBelts.install");
const API_MARKER = Symbol.for(transforms.API_SYMBOL);
const FOUR_MODE_MARKER = Symbol.for("evejs.fourModeAsteroidBelts.install");
const FOUR_MODE_API_MARKER = Symbol.for("evejs.fourModeAsteroidBelts");

function compileTransformed(filename, parent, transform) {
  if (Module._cache[filename]) return Module._cache[filename].exports;
  const instance = new Module(filename, parent);
  instance.filename = filename;
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  Module._cache[filename] = instance;
  try {
    const source = fs.readFileSync(filename, "utf8");
    instance._compile(transform(source), filename);
    instance.loaded = true;
    return instance.exports;
  } catch (error) {
    delete Module._cache[filename];
    throw error;
  }
}

function createCanonicalCache(canonicalize) {
  const identities = new Map();
  return function canonicalizeResolved(filename) {
    if (identities.has(filename)) return identities.get(filename);
    let succeeded = false;
    const canonical = canonicalize(filename, {
      realpath(value) {
        const result = (fs.realpathSync.native || fs.realpathSync)(value);
        succeeded = true;
        return result;
      },
    });
    if (succeeded) identities.set(filename, canonical);
    return canonical;
  };
}

function install(options = {}) {
  if (!isMainThread && options.allowWorker !== true) {
    return Object.freeze({ active: false, reason: "worker-thread" });
  }
  if (globalThis[INSTALL_MARKER] || globalThis[API_MARKER]) {
    throw new Error("TQ_ASTEROID_BELTS_ALREADY_INSTALLED");
  }
  if (globalThis[FOUR_MODE_MARKER] || globalThis[FOUR_MODE_API_MARKER]) {
    throw new Error("TQ_ASTEROID_BELTS_CONFLICTS_WITH_FOUR_MODE");
  }

  const runtimeRoot = path.resolve(
    options.runtimeRoot ||
    process.env.EVEJS_TQ_ASTEROID_BELTS_RUNTIME_ROOT ||
    path.join(__dirname, "../.."),
  );
  const target = viability.run(runtimeRoot);
  const api = createApi({ manifestPath: options.manifestPath });
  const canonicalizeResolved = createCanonicalCache(viability.canonicalize);
  const previousLoad = Module._load;
  globalThis[API_MARKER] = api;
  // The Launcher rejects this pair through manifest conflicts. Claiming the
  // FourMode API symbol also makes manual --require composition fail closed
  // regardless of preload order instead of silently replacing this transform.
  globalThis[FOUR_MODE_API_MARKER] = Object.freeze({ blockedBy: "tqasteroidbelts" });

  function hookedLoad(request, parent, isMain) {
    if (Module.isBuiltin(request)) return previousLoad.apply(this, arguments);
    let resolved;
    try {
      resolved = Module._resolveFilename(request, parent, isMain);
    } catch (_error) {
      return previousLoad.apply(this, arguments);
    }
    if (typeof resolved === "string" && canonicalizeResolved(resolved) === target.canonical) {
      return compileTransformed(target.filename, parent, transforms.transformAsteroidService);
    }
    return previousLoad.apply(this, arguments);
  }

  Module._load = hookedLoad;
  const installation = Object.freeze({ active: true, runtimeRoot, target, api, previousLoad, hookedLoad });
  globalThis[INSTALL_MARKER] = installation;
  return installation;
}

const installation = process.env.EVEJS_TQ_ASTEROID_BELTS_NO_AUTO_INSTALL === "1"
  ? Object.freeze({ active: false, reason: "auto-install-disabled" })
  : install();

module.exports = Object.freeze({
  ...installation,
  install,
  INSTALL_MARKER,
  API_MARKER,
  _testing: Object.freeze({ compileTransformed }),
});
