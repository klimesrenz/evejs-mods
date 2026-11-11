"use strict";

function createModuleTargetCache(targets, canonicalize) {
  const classifications = new Map();
  return function classify(resolvedFilename) {
    if (classifications.has(resolvedFilename)) return classifications.get(resolvedFilename);
    const kind = targets.get(canonicalize(resolvedFilename));
    classifications.set(resolvedFilename, kind);
    return kind;
  };
}

module.exports = { createModuleTargetCache };
