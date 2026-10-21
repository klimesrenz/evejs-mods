"use strict";
const fs = require("node:fs");
const path = require("node:path");
const markerPath = modRoot => path.join(modRoot, "_local/simulation-capability.json");
const canonical = value => path.resolve(value).toLowerCase();
function permitted(modRoot, runtimeRoot, bundle) {
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath(modRoot), "utf8"));
    return marker.schema === 1 && marker.enabled === true && marker.clientBuild === 3396210 &&
      marker.modRoot === canonical(modRoot) && marker.runtimeRoot === canonical(runtimeRoot) && marker.bundleDigest === bundle.digest;
  } catch (_) { return false; }
}
function record(modRoot, runtimeRoot, bundle, enabled) {
  const target = markerPath(modRoot);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // Helper lifecycle operations are serialized by Launcher. Atomic replacement
  // prevents a concurrent login from seeing partially written compatibility data.
  const temporary = target + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify({ schema: 1, enabled: !!enabled, clientBuild: 3396210,
    modRoot: canonical(modRoot), runtimeRoot: canonical(runtimeRoot), bundleDigest: bundle?.digest || null }));
  fs.renameSync(temporary, target);
}
function clear(modRoot) { fs.rmSync(markerPath(modRoot), { force: true }); }
module.exports = { permitted, record, clear };
