"use strict";

const fs = require("node:fs");
const path = require("node:path");
const transforms = require("./sourceTransforms");

const SOURCE_REQUIREMENTS = Object.freeze([
  {
    key: "moduleHeatMiningClassifier",
    file: "server/src/space/runtime/moduleHeat.js",
    required: ["function isMiningModuleItem(", "  isMiningModuleItem,"],
  },
  {
    key: "miningDogmaOverlay",
    file: "server/src/services/mining/miningDogma.js",
    required: ["function buildMiningModuleSnapshot(", "  buildMiningModuleSnapshot,"],
  },
  {
    key: "droneDogmaOverlay",
    file: "server/src/services/drone/droneDogma.js",
    required: [
      "function resolveDroneOperationalAttributes(",
      "function resolveDroneMiningSnapshot(",
      "  resolveDroneOperationalAttributes,",
      "  resolveDroneMiningSnapshot,",
    ],
  },
  {
    key: "fittingSnapshotOverlay",
    file: "server/src/_secondary/fitting/fittingSnapshotBuilder.js",
    required: ["function buildFittingSnapshot(", "  buildFittingSnapshot,"],
  },
  {
    key: "dogmaServiceOverlay",
    file: "server/src/services/dogma/dogmaService.js",
    required: [
      "_buildInventoryItemAttributes(item, session = null, options = {})",
      "module.exports = DogmaService;",
      "marshalDogmaAttributeValue,",
    ],
  },
]);

function inspectSourceShape(runtimeRoot, definition) {
  const filename = path.join(runtimeRoot, ...definition.file.split("/"));
  let source = "";
  try {
    source = fs.readFileSync(filename, "utf8");
  } catch (error) {
    return { key: definition.key, filename, ok: false, reason: error.message };
  }
  const problems = definition.required.flatMap((token) => {
    const count = source.split(token).length - 1;
    return count === 1
      ? []
      : [`API seam ${JSON.stringify(token)} count ${count}, expected 1`];
  });
  return {
    key: definition.key,
    filename,
    ok: problems.length === 0,
    reason: problems.length > 0 ? problems.join("; ") : null,
  };
}

function inspect(runtimeRoot) {
  const transformReport = transforms.inspect(runtimeRoot);
  const reports = [
    ...transformReport.reports,
    ...SOURCE_REQUIREMENTS.map((definition) => inspectSourceShape(runtimeRoot, definition)),
  ];
  return { ok: reports.every((report) => report.ok), reports };
}

module.exports = {
  SOURCE_REQUIREMENTS,
  inspect,
};
