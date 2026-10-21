"use strict";

const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { isMainThread } = require("node:worker_threads");

const MOD_VERSION = "0.5.0";
const MOD_DIR = __dirname;
const RUNTIME_ROOT = path.resolve(MOD_DIR, "../..");
const LOG_PREFIX = "[soloProgressionBalance]";
const INSTALL_FLAG = "__soloProgressionBalanceLoaderInstalled";
const API_SYMBOL = "evejs.soloProgressionBalance";

const OVERLAY_TARGETS = Object.freeze({
  miningDogma: "server/src/services/mining/miningDogma.js",
  droneDogma: "server/src/services/drone/droneDogma.js",
  fittingSnapshotBuilder: "server/src/_secondary/fitting/fittingSnapshotBuilder.js",
  dogmaService: "server/src/services/dogma/dogmaService.js",
});

function log(message) {
  console.log(`${LOG_PREFIX} ${message}`);
}

function logError(message, error = null) {
  console.error(`${LOG_PREFIX} ${message}`);
  if (error && error.stack) console.error(error.stack);
}

function canonicalize(filename, options = {}) {
  const platform = options.platform || process.platform;
  const resolved = path.resolve(String(filename || ""));
  const realpath = options.realpath || (fs.realpathSync.native || fs.realpathSync);
  let canonical;
  try {
    canonical = realpath(resolved);
  } catch (_error) {
    canonical = resolved;
  }
  if (platform === "win32") {
    return path.win32.normalize(canonical.replace(/\//gu, "\\")).toLowerCase();
  }
  return path.posix.normalize(canonical.replace(/\\/gu, "/"));
}

function resolveFilename(request, parent, isMain) {
  try {
    return Module._resolveFilename(request, parent, isMain);
  } catch (_error) {
    return null;
  }
}

function buildCanonicalTargetMap(runtimeRoot, transforms, options = {}) {
  const targetMap = new Map();
  const add = (kind, key, relative) => {
    const filename = path.resolve(runtimeRoot, ...relative.split("/"));
    const canonical = canonicalize(filename, options);
    if (targetMap.has(canonical)) {
      throw new Error(`duplicate canonical target: ${filename}`);
    }
    targetMap.set(canonical, Object.freeze({ kind, key, relative, filename, canonical }));
  };
  for (const [key, relative] of Object.entries(transforms.TARGETS)) {
    add("transform", key, relative);
  }
  for (const [key, relative] of Object.entries(OVERLAY_TARGETS)) {
    add("overlay", key, relative);
  }
  return targetMap;
}

function findPrecachedTargets(targetMap, options = {}) {
  const cachedByCanonical = new Map();
  for (const filename of Object.keys(Module._cache)) {
    cachedByCanonical.set(canonicalize(filename, options), filename);
  }
  return [...targetMap.values()]
    .filter((target) => cachedByCanonical.has(target.canonical))
    .map((target) => cachedByCanonical.get(target.canonical));
}

// Resolution still uses Node's parent-aware resolver on every call. Only
// successful filesystem identities are memoized; failed probes remain retryable.
// Do not reject by basename: symlinks/packages can alias an exact owned target.
function createCanonicalCache(canonicalize, options = {}) {
  const identities = new Map();
  return function canonicalizeResolved(filename) {
    if (identities.has(filename)) return identities.get(filename);
    let succeeded = false;
    const canonical = canonicalize(filename, {
      ...options,
      realpath(value) {
        const result = (options.realpath || fs.realpathSync.native || fs.realpathSync)(value);
        succeeded = true;
        return result;
      },
    });
    // canonicalize preserves its existing lexical fallback on realpath failure,
    // but that fallback must not prevent a later successful canonicalization.
    if (succeeded) identities.set(filename, canonical);
    return canonical;
  };
}

function installModuleHook(api, runtimeRoot, verbose, options = {}) {
  const transforms = require("./lib/sourceTransforms");
  const overlays = require("./lib/overlays");
  const canonicalTargets = buildCanonicalTargetMap(runtimeRoot, transforms, options);
  const cachedBeforeInstall = findPrecachedTargets(canonicalTargets, options);
  if (cachedBeforeInstall.length > 0) {
    throw new Error(
      `required target already cached before hook installation: ${cachedBeforeInstall.join(", ")}`,
    );
  }

  const canonicalizeResolved = createCanonicalCache(canonicalize, options);
  const previousLoad = Module._load;
  const transformed = new Set();
  const transforming = new Set();
  const overlaid = new Set();
  const loadedTargets = new Map();

  function installOverlay(target, result) {
    if (target.key === "miningDogma") {
      return overlays.installMiningDogma(result, api);
    }
    if (target.key === "droneDogma") {
      return overlays.installDroneDogma(result, api);
    }
    if (target.key === "fittingSnapshotBuilder") {
      return overlays.installFittingSnapshotBuilder(result, runtimeRoot);
    }
    return overlays.installDogmaService(result, api, runtimeRoot);
  }

  function hookedLoad(request, parent, isMain) {
    if (Module.isBuiltin(request)) return previousLoad.apply(this, arguments);
    const filename = resolveFilename(request, parent, isMain);
    if (!filename) return previousLoad.apply(this, arguments);
    const canonical = canonicalizeResolved(filename);
    const target = canonicalTargets.get(canonical);
    if (!target) return previousLoad.apply(this, arguments);

    if (loadedTargets.has(canonical)) {
      return loadedTargets.get(canonical);
    }

    if (target.kind === "transform") {
      if (transforming.has(canonical)) {
        const cached = Module._cache[target.filename];
        if (!cached) throw new Error(`transform recursion cache missing: ${target.filename}`);
        return cached.exports;
      }
      if (Module._cache[target.filename] || transformed.has(canonical)) {
        throw new Error(`transform target cached before application: ${target.filename}`);
      }
      transforming.add(canonical);
      try {
        const loaded = transforms.loadTransformed(target.filename, parent);
        if (!loaded.ok) {
          throw new Error(`source transform failed for ${target.filename}: ${loaded.reason}`);
        }
        transformed.add(canonical);
        loadedTargets.set(canonical, loaded.exports);
        if (verbose) {
          log(
            `in-memory transform ${loaded.alreadyInstalled ? "already present" : "applied"}: ${loaded.key}`,
          );
        }
        return loaded.exports;
      } finally {
        transforming.delete(canonical);
      }
    }

    const result = previousLoad.apply(this, arguments);
    const installed = installOverlay(target, result);
    if (!installed) {
      throw new Error(`required overlay was not installed: ${target.filename}`);
    }
    overlaid.add(canonical);
    loadedTargets.set(canonical, result);
    if (verbose) log(`export overlay applied: ${path.basename(target.filename)}`);
    return result;
  }

  Module._load = hookedLoad;
  return {
    canonicalTargets,
    loadedTargets,
    overlaid,
    previousLoad,
    transformed,
    transforming,
    hookedLoad,
  };
}

function install(options = {}) {
  if (!isMainThread) return { active: false, reason: "worker-thread" };
  if (globalThis[INSTALL_FLAG]) return { active: false, reason: "already-installed" };

  const runtimeRoot = path.resolve(options.runtimeRoot || RUNTIME_ROOT);
  const environment = options.environment || process.env;
  const config = require("./config").load(MOD_DIR, environment);
  if (!config.enabled) {
    log("inert — mod disabled; vanilla EveJS behavior retained");
    return { active: false, reason: "disabled", config };
  }
  if (config.problems.length > 0) {
    for (const problem of config.problems) logError(problem);
    logError("invalid mod-owned configuration — no hooks installed");
    return { active: false, reason: "invalid-config", config };
  }

  const viable = require("./lib/viability").inspect(runtimeRoot);
  if (!viable.ok) {
    logError("viability gate failed — no hooks installed");
    for (const report of viable.reports.filter((entry) => !entry.ok)) {
      logError(`${report.key}: ${report.reason}`);
    }
    return { active: false, reason: "not-viable", config, viable };
  }

  const apiMarker = Symbol.for(API_SYMBOL);
  const api = require("./lib/runtimeApi").createRuntimeApi(config, runtimeRoot);
  let hookState = null;
  try {
    hookState = installModuleHook(api, runtimeRoot, config.verbose, options.canonicalizeOptions);
    globalThis[apiMarker] = api;
    const installState = Object.freeze({
      active: true,
      config,
      viable,
      runtimeRoot,
      hookState,
    });
    globalThis[INSTALL_FLAG] = installState;
    log(
      `v${MOD_VERSION} active — mining ${config.miningYieldScale}x, ` +
        `drone ${config.miningDroneYieldScale}x, holds ${config.miningHoldScale}x, ` +
        `logistics ${config.logisticsCargoScale}x`,
    );
    return installState;
  } catch (error) {
    if (hookState && Module._load === hookState.hookedLoad) {
      Module._load = hookState.previousLoad;
    }
    if (globalThis[apiMarker] === api) delete globalThis[apiMarker];
    if (globalThis[INSTALL_FLAG] && globalThis[INSTALL_FLAG].hookState === hookState) {
      delete globalThis[INSTALL_FLAG];
    }
    throw error;
  }
}

let installResult = null;
try {
  installResult = install();
} catch (error) {
  logError("loader failed before activation", error);
  installResult = { active: false, reason: "exception", error };
}

module.exports = {
  API_SYMBOL,
  INSTALL_FLAG,
  MOD_DIR,
  MOD_VERSION,
  OVERLAY_TARGETS,
  RUNTIME_ROOT,
  canonicalize,
  install,
  installResult,
  _testing: Object.freeze({ buildCanonicalTargetMap, findPrecachedTargets, installModuleHook }),
};

// Simulation is optional and cannot unwind the already-installed gameplay hooks.
try {
  module.exports.simulation = require("./simulation").install(
    installResult, globalThis[Symbol.for(API_SYMBOL)], RUNTIME_ROOT, MOD_DIR,
  );
  if (!module.exports.simulation.active) log(`simulation unavailable: ${module.exports.simulation.reason}; gameplay unchanged`);
} catch (error) {
  logError("optional simulation unavailable; gameplay unchanged", error);
  module.exports.simulation = { active: false, reason: "optional-preflight-failed" };
}
