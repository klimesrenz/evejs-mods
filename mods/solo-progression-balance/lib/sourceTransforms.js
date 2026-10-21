"use strict";

const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const API_SYMBOL = "evejs.soloProgressionBalance";
const TARGETS = Object.freeze({
  liveFittingState: "server/src/services/fitting/liveFittingState.js",
  moduleAttributes: "server/src/space/runtime/moduleAttributes.js",
  droneRuntime: "server/src/services/drone/droneRuntime.js",
});
const MARKERS = Object.freeze({
  liveFittingState: "soloProgressionBalance: ship capacity scales",
  moduleAttributes: "soloProgressionBalance: mining module client sync",
  droneWindowSettle: "soloProgressionBalance: settle dogma prime",
  droneDogmaPrime: "soloProgressionBalance: fresh drone dogma prime",
  droneDogmaRefresh: "soloProgressionBalance: fresh drone dogma refresh",
  droneLaunchPrime: "soloProgressionBalance: launch dogma prime",
});

function normalizePath(value) {
  return String(value || "").split(path.sep).join("/");
}

function countText(source, token) {
  return String(source).split(token).length - 1;
}

function findUniqueFunctionScope(source, functionToken, label) {
  const text = String(source);
  const count = countText(text, functionToken);
  if (count !== 1) {
    throw new Error(`${label}: function anchor count ${count}, expected 1`);
  }
  const start = text.indexOf(functionToken);
  const nextFunction = text.indexOf("\nfunction ", start + functionToken.length);
  const end = nextFunction >= 0 ? nextFunction + 1 : text.length;
  return { start, end, scoped: text.slice(start, end) };
}

function analyzeOwnedSeam(source, vanilla, installed, marker, label) {
  const vanillaCount = countText(source, vanilla);
  const installedCount = countText(source, installed);
  const markerCount = countText(source, marker);

  if (vanillaCount === 1 && installedCount === 0 && markerCount === 0) {
    return "vanilla";
  }
  if (vanillaCount === 0 && installedCount === 1 && markerCount === 1) {
    return "installed";
  }
  if (vanillaCount > 1 || installedCount > 1 || markerCount > 1) {
    throw new Error(
      `${label}: ambiguous seam (vanilla=${vanillaCount}, installed=${installedCount}, marker=${markerCount})`,
    );
  }
  if (markerCount > 0 || installedCount > 0 || (vanillaCount > 0 && installedCount > 0)) {
    throw new Error(`${label}: conflicting Solo transform at owned seam`);
  }
  throw new Error(`${label}: required seam missing or changed`);
}

function analyzeScopedSeam(source, definition) {
  const scope = findUniqueFunctionScope(
    source,
    definition.functionToken,
    definition.label,
  );
  const markerOutsideScope =
    countText(source, definition.marker) - countText(scope.scoped, definition.marker);
  if (markerOutsideScope !== 0) {
    throw new Error(`${definition.label}: Solo marker found outside owned function`);
  }
  return {
    ...scope,
    status: analyzeOwnedSeam(
      scope.scoped,
      definition.vanilla,
      definition.installed,
      definition.marker,
      definition.label,
    ),
  };
}

function applyScopedSeam(source, definition) {
  const analysis = analyzeScopedSeam(source, definition);
  if (analysis.status === "installed") {
    return { source: String(source), alreadyInstalled: true };
  }
  const transformedScope = analysis.scoped.replace(
    definition.vanilla,
    definition.installed,
  );
  return {
    source:
      String(source).slice(0, analysis.start) +
      transformedScope +
      String(source).slice(analysis.end),
    alreadyInstalled: false,
  };
}

const LIVE_FITTING_SEAM = Object.freeze({
  functionToken: "function buildShipResourceState(",
  vanilla: "  const resourceState = {",
  installed:
    `  globalThis[Symbol.for("${API_SYMBOL}")]?.applyShipCapacityScales(` +
    "derivedAttributes, { characterID: numericCharID, shipItem, shipMetadata }); " +
    `/* ${MARKERS.liveFittingState} */ const resourceState = {`,
  marker: MARKERS.liveFittingState,
  label: "liveFittingState capacity pipeline",
});

const SPACE_RUNTIME_VANILLA =
  "  const attributeOverrides = resolveGenericModuleAttributeOverrides(\n" +
  "    characterID,\n" +
  "    shipItem,\n" +
  "    moduleItem,\n" +
  "    chargeItem,\n" +
  "    options,\n" +
  "  );";
const SPACE_RUNTIME_INSTALLED =
  "  let attributeOverrides = resolveGenericModuleAttributeOverrides(\n" +
  "    characterID,\n" +
  "    shipItem,\n" +
  "    moduleItem,\n" +
  "    chargeItem,\n" +
  "    options,\n" +
  `  ); /* ${MARKERS.moduleAttributes} */ attributeOverrides = ` +
  `globalThis[Symbol.for("${API_SYMBOL}")]?.applyMiningModuleClientSync(` +
  "characterID, require(\"./moduleHeat\").isMiningModuleItem(moduleItem), attributeOverrides) || attributeOverrides;";
const SPACE_RUNTIME_SEAM = Object.freeze({
  functionToken: "function getGenericModuleRuntimeAttributes(",
  vanilla: SPACE_RUNTIME_VANILLA,
  installed: SPACE_RUNTIME_INSTALLED,
  marker: MARKERS.moduleAttributes,
  label: "moduleAttributes module-attribute pipeline",
});

const DRONE_SEAMS = Object.freeze([
  Object.freeze({
    functionToken: "function refreshDroneWindowInventoryRows(",
    vanilla: "        skipDogmaPrime: true,",
    installed:
      `        skipDogmaPrime: false, // ${MARKERS.droneWindowSettle}`,
    marker: MARKERS.droneWindowSettle,
    label: "droneRuntime settle prime",
  }),
  Object.freeze({
    functionToken: "function emitDroneDogmaPrime(",
    vanilla:
      "  const attributeOverrides = resolveDroneTooltipAttributes(\n" +
      "    dogmaPrimeItem,\n" +
      "    targetSessions[0] || null,\n" +
      "    { controllerShipID: toInt(shipRecord.itemID, 0) },\n" +
      "  );",
    installed:
      "  const upstreamAttributeOverrides = resolveDroneTooltipAttributes(\n" +
      "    dogmaPrimeItem,\n" +
      "    targetSessions[0] || null,\n" +
      "    { controllerShipID: toInt(shipRecord.itemID, 0) },\n" +
      `  ); /* ${MARKERS.droneDogmaPrime} */ const attributeOverrides = ` +
      `globalThis[Symbol.for("${API_SYMBOL}")]?.scaleDroneOperationalAttributes(` +
      "upstreamAttributeOverrides, { session: targetSessions[0], ownerID: shipRecord.ownerID }) || upstreamAttributeOverrides;",
    marker: MARKERS.droneDogmaPrime,
    label: "droneRuntime operational prime",
  }),
  Object.freeze({
    functionToken: "function handleControllerDogmaCacheRebuilt(",
    vanilla:
      "      const attributes = resolveDroneTooltipAttributes(\n" +
      "        droneItem,\n" +
      "        interestedSessions[0] || session,\n" +
      "        {\n" +
      "          controllerShipID: shipID,\n" +
      "          controllerEntity,\n" +
      "          scene,\n" +
      "        },\n" +
      "      );",
    installed:
      "      const upstreamAttributes = resolveDroneTooltipAttributes(\n" +
      "        droneItem,\n" +
      "        interestedSessions[0] || session,\n" +
      "        {\n" +
      "          controllerShipID: shipID,\n" +
      "          controllerEntity,\n" +
      "          scene,\n" +
      `        },\n      ); /* ${MARKERS.droneDogmaRefresh} */ const attributes = ` +
      `globalThis[Symbol.for("${API_SYMBOL}")]?.scaleDroneOperationalAttributes(` +
      "upstreamAttributes, controllerEntity) || upstreamAttributes;",
    marker: MARKERS.droneDogmaRefresh,
    label: "droneRuntime cache rebuild comparison",
  }),
  Object.freeze({
    functionToken: "function launchDronesForSession(",
    vanilla: "        skipDogmaPrime: true,",
    installed:
      `        skipDogmaPrime: false, // ${MARKERS.droneLaunchPrime}`,
    marker: MARKERS.droneLaunchPrime,
    label: "droneRuntime launch prime",
  }),
]);

function transformLiveFittingStateDetailed(source) {
  return applyScopedSeam(String(source), LIVE_FITTING_SEAM);
}

function transformLiveFittingState(source) {
  return transformLiveFittingStateDetailed(source).source;
}

function transformSpaceRuntimeDetailed(source) {
  const text = String(source);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const seam = eol === "\n"
    ? SPACE_RUNTIME_SEAM
    : {
        ...SPACE_RUNTIME_SEAM,
        vanilla: SPACE_RUNTIME_SEAM.vanilla.replace(/\n/gu, eol),
        installed: SPACE_RUNTIME_SEAM.installed.replace(/\n/gu, eol),
      };
  return applyScopedSeam(text, seam);
}

function transformSpaceRuntime(source) {
  return transformSpaceRuntimeDetailed(source).source;
}

function transformDroneRuntimeDetailed(source) {
  const text = String(source);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const normalizedSeams = DRONE_SEAMS.map((definition) =>
    eol === "\n" ? definition : {
      ...definition,
      vanilla: definition.vanilla.replace(/\n/gu, eol),
      installed: definition.installed.replace(/\n/gu, eol),
    },
  );
  const analyses = normalizedSeams.map((definition) => ({
    definition,
    analysis: analyzeScopedSeam(text, definition),
  }));
  const statuses = new Set(analyses.map(({ analysis }) => analysis.status));
  if (statuses.size !== 1) {
    throw new Error("droneRuntime: partial or conflicting Solo transform installation");
  }
  if (statuses.has("installed")) {
    return { source: text, alreadyInstalled: true };
  }

  let transformed = text;
  for (const { definition } of analyses) {
    transformed = applyScopedSeam(transformed, definition).source;
  }
  return { source: transformed, alreadyInstalled: false };
}

function transformDroneRuntime(source) {
  return transformDroneRuntimeDetailed(source).source;
}

function targetKeyForFile(filename) {
  const normalized = normalizePath(filename);
  return Object.entries(TARGETS).find(([, suffix]) => normalized.endsWith(suffix))?.[0] || null;
}

function transformSource(filename, source) {
  const key = targetKeyForFile(filename);
  if (!key) return { ok: false, source, reason: `not a transform target: ${filename}` };
  try {
    const before = String(source);
    const result = key === "liveFittingState"
      ? transformLiveFittingStateDetailed(before)
      : key === "moduleAttributes"
        ? transformSpaceRuntimeDetailed(before)
        : transformDroneRuntimeDetailed(before);
    const linesBefore = before.split("\n").length;
    const linesAfter = result.source.split("\n").length;
    if (linesBefore !== linesAfter) {
      return { ok: false, source: before, reason: `${key} line count changed ${linesBefore} -> ${linesAfter}` };
    }
    return {
      ok: true,
      source: result.source,
      reason: null,
      key,
      alreadyInstalled: result.alreadyInstalled === true,
    };
  } catch (error) {
    return { ok: false, source: String(source), reason: error.message, key };
  }
}

function inspect(runtimeRoot) {
  const reports = [];
  for (const [key, suffix] of Object.entries(TARGETS)) {
    const filename = path.join(runtimeRoot, ...suffix.split("/"));
    let source = "";
    try {
      source = fs.readFileSync(filename, "utf8");
    } catch (error) {
      reports.push({ key, filename, ok: false, reason: error.message });
      continue;
    }
    const result = transformSource(filename, source);
    reports.push({
      key,
      filename,
      ok: result.ok,
      reason: result.reason,
      alreadyInstalled: result.alreadyInstalled === true,
    });
  }
  return { ok: reports.every((report) => report.ok), reports };
}

function requestLooksLikeTarget(request) {
  return typeof request === "string" && [
    "liveFittingState",
    "space/runtime/moduleAttributes",
    "droneRuntime",
  ].some((token) => request.includes(token));
}

function isTargetFile(filename) {
  return targetKeyForFile(filename) !== null;
}

function loadTransformed(filename, parent) {
  const source = fs.readFileSync(filename, "utf8");
  const result = transformSource(filename, source);
  if (!result.ok) return { ok: false, exports: null, reason: result.reason };
  const compiled = new Module(filename, parent || null);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  Module._cache[filename] = compiled;
  try {
    compiled._compile(result.source, filename);
    compiled.loaded = true;
  } catch (error) {
    delete Module._cache[filename];
    return { ok: false, exports: null, reason: `compile failed: ${error.message}` };
  }
  return {
    ok: true,
    exports: compiled.exports,
    reason: null,
    key: result.key,
    alreadyInstalled: result.alreadyInstalled === true,
  };
}

module.exports = {
  API_SYMBOL,
  MARKERS,
  TARGETS,
  inspect,
  isTargetFile,
  loadTransformed,
  requestLooksLikeTarget,
  targetKeyForFile,
  transformDroneRuntime,
  transformLiveFittingState,
  transformSource,
  transformSpaceRuntime,
};
