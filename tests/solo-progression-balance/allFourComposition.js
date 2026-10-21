"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const runtimeRoot = path.resolve(process.env.EVEJS_ROOT || path.join(__dirname, "../../../EveJS"));
const modsRoot = path.join(runtimeRoot, "mods");
const soloRoot = path.resolve(__dirname, "../../mods/solo-progression-balance");
const requiredPaths = [
  path.join(modsRoot, "droneClassBalance/lib/sourceTransforms.js"),
  path.join(modsRoot, "droneClassBalance/loader.js"),
  path.join(modsRoot, "fourModeAsteroidBelts/loader.js"),
  path.join(modsRoot, "moonOreAnomalies/loader.js"),
  path.join(modsRoot, "moonOreAnomalies/data/moonOreSiteRules.json"),
  path.join(runtimeRoot, "server/src/services/fitting/liveFittingState.js"),
];
const missingPaths = requiredPaths.filter(file => !fs.existsSync(file));
if (missingPaths.length) {
  console.log(`SKIP four-mod composition; missing dependencies: ${missingPaths.join(", ")}`);
  process.exit(0);
}
const droneTransforms = require(path.join(
  modsRoot,
  "droneClassBalance/lib/sourceTransforms",
));
const soloTransforms = require(path.join(
  soloRoot,
  "lib/sourceTransforms",
));

const liveFittingFile = path.join(
  runtimeRoot,
  "server/src/services/fitting/liveFittingState.js",
);
const liveFittingSource = fs.readFileSync(liveFittingFile, "utf8");

function applySolo(source) {
  const result = soloTransforms.transformSource(liveFittingFile, source);
  assert.equal(result.ok, true, result.reason);
  return result;
}

const soloThenDrone = droneTransforms.transformLiveFittingStateSource(
  applySolo(liveFittingSource).source,
);
const droneThenSolo = applySolo(
  droneTransforms.transformLiveFittingStateSource(liveFittingSource).source,
);
assert.equal(soloThenDrone.source, droneThenSolo.source);
assert.equal(
  soloThenDrone.source.split(droneTransforms.MARKER).length - 1,
  1,
);
assert.equal(
  soloThenDrone.source.split(soloTransforms.MARKERS.liveFittingState).length - 1,
  1,
);
assert.doesNotThrow(() => new Function(
  "require",
  "module",
  "exports",
  "__filename",
  "__dirname",
  soloThenDrone.source,
));
assert.equal(
  droneTransforms.transformLiveFittingStateSource(soloThenDrone.source).alreadyInstalled,
  true,
);
assert.equal(applySolo(soloThenDrone.source).alreadyInstalled, true);
console.log("PASS Drone + Solo shared source composes identically in both transform orders");

const loaders = Object.freeze({
  drone: path.join(modsRoot, "droneClassBalance/loader.js"),
  solo: path.join(soloRoot, "loader.js"),
  four: path.join(modsRoot, "fourModeAsteroidBelts/loader.js"),
  moon: path.join(modsRoot, "moonOreAnomalies/loader.js"),
});
const rulesFile = path.join(
  modsRoot,
  "moonOreAnomalies/data/moonOreSiteRules.json",
);

function permutations(values) {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) => permutations([
    ...values.slice(0, index),
    ...values.slice(index + 1),
  ]).map((tail) => [value, ...tail]));
}

function runChild(source, timeout = 45_000) {
  const child = spawnSync(process.execPath, ["-e", source], {
    cwd: runtimeRoot,
    encoding: "utf8",
    timeout,
    env: {
      ...process.env,
      EVEJS_MOON_ORE_ANOMALIES_TEST_NO_AUTOINSTALL: "1",
      EVEJS_SOLO_PROGRESSION_BALANCE: "1",
    },
  });
  assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
  return child.stdout;
}

for (const order of permutations(["drone", "solo", "four", "moon"])) {
  const source = `
    const path = require("node:path");
    const loaders = ${JSON.stringify(loaders)};
    const order = ${JSON.stringify(order)};
    let drone;
    let solo;
    let four;
    let moon;
    for (const name of order) {
      if (name === "moon") {
        const loader = require(loaders.moon);
        moon = loader.install({
          runtimeRoot: ${JSON.stringify(runtimeRoot)},
          config: { enabled: true, verbose: false },
          rules: require(${JSON.stringify(rulesFile)}),
          systemIDs: [30000001],
        });
      } else {
        const loaded = require(loaders[name]);
        if (name === "drone") drone = loaded;
        if (name === "solo") solo = loaded;
        if (name === "four") four = loaded;
      }
    }
    require(path.join(${JSON.stringify(runtimeRoot)}, "server/src/services/fitting/liveFittingState"));
    require(path.join(${JSON.stringify(runtimeRoot)}, "server/src/space/runtime/moduleAttributes"));
    require(path.join(${JSON.stringify(runtimeRoot)}, "server/src/services/drone/droneRuntime"));
    if (!drone.installResult.active || !drone.installResult.transformApplied) throw new Error("drone inactive");
    if (!solo.installResult.active || solo.installResult.hookState.transformed.size !== 3) throw new Error("solo transforms incomplete");
    if (!four.active) throw new Error("four inactive");
    if (!moon.active) throw new Error("moon inactive");
    console.log("ORDER_OK");
  `;
  assert.match(runChild(source), /ORDER_OK/u);
  console.log(`PASS loader order ${order.join(" -> ")}`);
}

const comprehensive = `
  const path = require("node:path");
  const runtimeRoot = ${JSON.stringify(runtimeRoot)};
  const loaders = ${JSON.stringify(loaders)};
  const drone = require(loaders.drone);
  const solo = require(loaders.solo);
  const four = require(loaders.four);
  const moonLoader = require(loaders.moon);
  const moon = moonLoader.install({
    runtimeRoot,
    config: { enabled: true, verbose: false },
    rules: require(${JSON.stringify(rulesFile)}),
    systemIDs: [30000001],
  });
  const targets = [
    "server/src/services/fitting/liveFittingState",
    "server/src/space/runtime/moduleAttributes",
    "server/src/services/drone/droneRuntime",
    "server/src/services/mining/miningDogma",
    "server/src/services/drone/droneDogma",
    "server/src/_secondary/fitting/fittingSnapshotBuilder",
    "server/src/services/dogma/dogmaService",
    "server/src/space/asteroids/asteroidService",
    "server/src/services/mining/miningRuntimeState",
    "server/src/services/chat/chatCommands",
    "server/src/contentPacks/contentPackManager",
    "server/src/services/dungeon/dungeonUniverseRuntime",
    "server/src/services/exploration/explorationAuthority",
    "server/src/services/dungeon/globalSiteSchedulerRuntime",
    "server/src/services/dungeon/dungeonRuntime",
  ];
  const loaded = Object.fromEntries(targets.map((relative) => [
    relative,
    require(path.join(runtimeRoot, relative)),
  ]));
  if (!drone.installResult.transformApplied) throw new Error("drone transform missing");
  if (solo.installResult.hookState.transformed.size !== 3) throw new Error("solo transform count");
  if (solo.installResult.hookState.overlaid.size !== 4) throw new Error("solo overlay count");
  const chat = loaded["server/src/services/chat/chatCommands"];
  if (!chat.AVAILABLE_SLASH_COMMANDS.includes("beltmode") || !chat.AVAILABLE_SLASH_COMMANDS.includes("beltvolume")) throw new Error("four chat overlay missing");
  if (moon.installedTargets.size !== 4) throw new Error("moon overlay count");
  console.log("ALL_FOUR_OK");
`;
assert.match(runChild(comprehensive, 60_000), /ALL_FOUR_OK/u);
console.log("PASS all four loaders transform and overlay every owned final target together");
