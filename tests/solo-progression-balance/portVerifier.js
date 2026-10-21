"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const modDir = path.resolve(__dirname, "../../mods/solo-progression-balance");
const cleanRoot = path.resolve(
  process.argv[2] || process.env.EVEJS_ROOT || path.join(__dirname, "../../../EveJS"),
);
const overlays = require(path.join(modDir, "lib/overlays"));
const transforms = require(path.join(modDir, "lib/sourceTransforms"));
const viability = require(path.join(modDir, "lib/viability"));

const results = [];

function test(name, operation) {
  operation();
  results.push(name);
}

function readTransformTarget(key) {
  const relative = transforms.TARGETS[key];
  const filename = path.join(cleanRoot, ...relative.split("/"));
  return { filename, source: fs.readFileSync(filename, "utf8") };
}

test("clean EveJS 261018.1 target contracts and transforms", () => {
  const report = viability.inspect(cleanRoot);
  assert.strictEqual(
    report.ok,
    true,
    report.reports.filter((entry) => !entry.ok).map((entry) => entry.reason).join("; "),
  );

  for (const key of Object.keys(transforms.TARGETS)) {
    const { filename, source } = readTransformTarget(key);
    const transformed = transforms.transformSource(filename, source);
    assert.strictEqual(transformed.ok, true, transformed.reason);
    assert.strictEqual(transformed.alreadyInstalled, false);
    assert.notStrictEqual(transformed.source, source);
    assert.doesNotThrow(() => new Function(
      "require",
      "module",
      "exports",
      "__dirname",
      "__filename",
      transformed.source,
    ));

    const repeated = transforms.transformSource(filename, transformed.source);
    assert.strictEqual(repeated.ok, true, repeated.reason);
    assert.strictEqual(repeated.alreadyInstalled, true);
    assert.strictEqual(repeated.source, transformed.source);
  }
});

test("unrelated edits are preserved for every transformed source", () => {
  const unrelatedEdit = "// synthetic unrelated edit preserved by Solo\n";
  for (const key of Object.keys(transforms.TARGETS)) {
    const { filename, source } = readTransformTarget(key);
    const incoming = unrelatedEdit + source;
    const transformed = transforms.transformSource(filename, incoming);
    assert.strictEqual(transformed.ok, true, transformed.reason);
    assert.strictEqual(transformed.source.startsWith(unrelatedEdit), true);
  }
});

test("changed and duplicated owned seams fail closed", () => {
  const live = readTransformTarget("liveFittingState");
  const alteredLiveSource = live.source.replace(
    "  const resourceState = {",
    "  const resourceState /* synthetic overlapping edit */ = {",
  );
  assert.notStrictEqual(alteredLiveSource, live.source);
  const altered = transforms.transformSource(live.filename, alteredLiveSource);
  assert.strictEqual(altered.ok, false);
  assert.match(altered.reason, /required seam missing or changed/u);
  assert.strictEqual(altered.source, alteredLiveSource);

  const space = readTransformTarget("moduleAttributes");
  const ownedCallPattern =
    /  const attributeOverrides = resolveGenericModuleAttributeOverrides\(\r?\n    characterID,\r?\n    shipItem,\r?\n    moduleItem,\r?\n    chargeItem,\r?\n    options,\r?\n  \);/gu;
  const matches = [...space.source.matchAll(ownedCallPattern)];
  assert.strictEqual(matches.length, 1);
  const eol = space.source.includes("\r\n") ? "\r\n" : "\n";
  const duplicatedSpaceSource = space.source.replace(
    matches[0][0],
    `${matches[0][0]}${eol}${matches[0][0]}`,
  );
  const duplicated = transforms.transformSource(
    space.filename,
    duplicatedSpaceSource,
  );
  assert.strictEqual(duplicated.ok, false);
  assert.match(duplicated.reason, /ambiguous seam/u);
  assert.strictEqual(duplicated.source, duplicatedSpaceSource);
});

test("launched-drone prime and cache refresh scale the fresh complete upstream map", () => {
  const runtime = readTransformTarget("droneRuntime");
  const transformed = transforms.transformSource(runtime.filename, runtime.source);
  assert.strictEqual(transformed.ok, true, transformed.reason);
  const start = transformed.source.indexOf("function emitDroneDogmaPrime(");
  const end = transformed.source.indexOf("\nfunction ", start + 1);
  assert.ok(start >= 0 && end > start);
  const scope = transformed.source.slice(start, end);
  assert.match(
    scope,
    /const upstreamAttributeOverrides = resolveDroneTooltipAttributes\([\s\S]*?const attributeOverrides = globalThis\[Symbol\.for\("evejs\.soloProgressionBalance"\)\]\?\.scaleDroneOperationalAttributes\(upstreamAttributeOverrides, \{ session: targetSessions\[0\], ownerID: shipRecord\.ownerID \}\) \|\| upstreamAttributeOverrides/u,
  );
  assert.match(scope, /attributeOverrides: attributeOverrides \|\| \{\}/u);
  assert.match(scope, /buildDroneTooltipAttributeStamp\(attributeOverrides\)/u);
  assert.doesNotMatch(scope, /entity\.passiveDerivedState/u);
  assert.doesNotMatch(
    scope,
    /includeTypeAttributes: true[^\r\n]*attributeOverrides:/u,
  );

  const vanillaStart = runtime.source.indexOf("function emitDroneDogmaPrime(");
  const vanillaEnd = runtime.source.indexOf("\nfunction ", vanillaStart + 1);
  const vanillaScope = runtime.source.slice(vanillaStart, vanillaEnd);
  const incompleteScope = vanillaScope.replace(
    "  const attributeOverrides = resolveDroneTooltipAttributes(",
    "  const attributeOverrides = resolveOtherAttributes(",
  );
  assert.notStrictEqual(incompleteScope, vanillaScope);
  const incompletePremise =
    runtime.source.slice(0, vanillaStart) +
    incompleteScope +
    runtime.source.slice(vanillaEnd);
  const rejected = transforms.transformSource(runtime.filename, incompletePremise);
  assert.strictEqual(rejected.ok, false);
  assert.match(rejected.reason, /required seam missing or changed/u);
  assert.strictEqual(rejected.source, incompletePremise);

  const refreshStart = transformed.source.indexOf("function handleControllerDogmaCacheRebuilt(");
  const refreshEnd = transformed.source.indexOf("\nfunction ", refreshStart + 1);
  const refreshScope = transformed.source.slice(refreshStart, refreshEnd);
  assert.match(
    refreshScope,
    /const upstreamAttributes = resolveDroneTooltipAttributes\([\s\S]*?const attributes = globalThis\[Symbol\.for\("evejs\.soloProgressionBalance"\)\]\?\.scaleDroneOperationalAttributes\(upstreamAttributes, controllerEntity\) \|\| upstreamAttributes/u,
  );
  assert.match(refreshScope, /buildDroneTooltipAttributeStamp\(attributes\)/u);
  assert.doesNotMatch(refreshScope, /droneEntity\.passiveDerivedState/u);
});

test("fitting overlay preserves upstream mode inputs and active contexts", () => {
  const activeModuleContexts = Object.freeze([{ moduleItem: { itemID: 701 } }]);
  const callerOptions = Object.freeze({
    assumeActiveShipModules: false,
    reason: "port-verifier",
  });
  const moduleItem = { itemID: 7001, typeID: 8001, flagID: 27 };
  const receiver = {};
  let capturedArguments = null;
  let capturedReceiver = null;
  let miningOptions = null;
  const fakeBuilder = {
    buildFittingSnapshot: function buildFittingSnapshot() {
      capturedArguments = [...arguments];
      capturedReceiver = this;
      return {
        characterID: 90000001,
        shipItem: { itemID: 5001 },
        fittedItems: [
          moduleItem,
          { itemID: 8001, typeID: 9000, categoryID: 8, flagID: 27 },
        ],
        skillMap: new Map(),
        assumeActiveShipModules: false,
        assumedActiveModuleContexts: activeModuleContexts,
        getModuleAttributeOverrides: () => ({ 30: 10, 50: 20 }),
      };
    },
  };

  overlays.installFittingSnapshotBuilder(fakeBuilder, cleanRoot, {
    miningDogma: {
      buildMiningModuleSnapshot(options) {
        miningOptions = options;
        return { miningAmountM3: 300 };
      },
    },
    resolveItemByTypeID: () => ({ categoryID: 8 }),
  });

  const shipReference = { itemID: 5001 };
  const snapshot = fakeBuilder.buildFittingSnapshot.call(
    receiver,
    90000001,
    shipReference,
    callerOptions,
  );
  assert.strictEqual(capturedReceiver, receiver);
  assert.strictEqual(capturedArguments[0], 90000001);
  assert.strictEqual(capturedArguments[1], shipReference);
  assert.strictEqual(capturedArguments[2], callerOptions);
  assert.strictEqual(snapshot.assumeActiveShipModules, false);

  assert.deepStrictEqual(
    snapshot.getModuleAttributeOverrides(moduleItem),
    { 30: 10, 50: 20, 77: 300 },
  );
  assert.strictEqual(miningOptions.activeModuleContexts, activeModuleContexts);
});

for (const name of results) {
  console.log(`PASS ${name}`);
}
console.log(`PASS ${results.length} targeted Solo EveJS 261018.1 port checks`);
