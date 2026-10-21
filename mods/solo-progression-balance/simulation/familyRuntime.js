"use strict";
// Embedded private ABI 1. Both of our mods must retain this arbitration contract.
// Each package carries its own files; neither loads files from the other package.
const Module = require("node:module");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  KEY,
  SUPPORTED_EVEJS_VERSION,
  supportsRoot,
  extendSource,
  bundleDigest,
  createDelivery,
} = require("./delivery");
const FAMILIES = Object.freeze(["droneclassbalance", "soloprogressionbalance"]);
const AUTO_MINING_KEY = Symbol.for("evejs.automining.loader.v1");
const AUTO_MINING_BRIDGE = Symbol.for("evejs.ourMods.privateFittingRuntime.autoMiningBridge");
const canonical = filename => path.resolve(filename).toLowerCase();

function validMember(member) {
  const b = member?.bundle;
  return FAMILIES.includes(member?.id) && typeof member.policy === "function" && typeof member.eligible === "function" && b?.abi === 1 &&
    Number.isSafeInteger(b.revision) && b.revision > 0 && b.wireSchema === 1 &&
    Array.isArray(b.families) && b.families.length > 0 && b.families.every(id => FAMILIES.includes(id)) &&
    typeof b.adapter === "string" && typeof b.bootstrap === "string" && b.fingerprints &&
    b.digest === bundleDigest(b);
}

function createState(runtimeRoot, host = globalThis, moduleHost = Module) {
  const target = canonical(path.join(runtimeRoot, "server/src/network/tcp/handshake.js"));
  const members = new Map();
  const warned = new Set();
  const state = {
    abi: 1, runtimeRoot: canonical(runtimeRoot), active: true, transformed: false, conflict: false,
    warn(reason) {
      if (!warned.has(reason)) { warned.add(reason); console.warn(`[droneClassBalance/simulation] ${reason}; vanilla simulation retained.`); }
    },
    add(member) {
      // Duplicate family owners are unsupported; repeated identical registration is harmless.
      if (!validMember(member) || members.has(member?.id) && members.get(member.id) !== member) {
        state.conflict = true;
        state.warn("Incompatible private runtime registration");
        return false;
      }
      members.set(member.id, member);
      return true;
    },
    snapshot() {
      if (state.conflict || !members.size) return null;
      const sorted = FAMILIES.filter(id => members.has(id)).map(id => members.get(id)).filter(member => {
        try { return member.eligible() === true; }
        catch (_) { state.warn(`${member.id} compatibility unavailable`); return false; }
      });
      if (!sorted.length) return null;
      // A same-revision disagreement is never resolved by load order.
      const revisions = new Map();
      for (const { bundle } of sorted) {
        if (revisions.has(bundle.revision) && revisions.get(bundle.revision) !== bundle.digest) {
          state.warn("Private runtime bundle disagreement"); return null;
        }
        revisions.set(bundle.revision, bundle.digest);
      }
      const bundle = sorted.reduce((best, item) => item.bundle.revision > best.revision ? item.bundle : best, sorted[0].bundle);
      const providers = {};
      for (const member of sorted) {
        try {
          const policy = member.policy();
          if (policy === null || policy === undefined) continue;
          if (policy.schema !== 1 || policy.evejs !== SUPPORTED_EVEJS_VERSION || policy.clientBuild !== 3396210 ||
              Object.keys(policy.providers || {}).length !== 1 || !policy.providers[member.id]) throw Error("invalid policy envelope");
          providers[member.id] = policy.providers[member.id];
        } catch (error) { state.warn(`${member.id} policy unavailable`); }
      }
      if (Object.keys(providers).some(id => !bundle.families.includes(id))) {
        state.warn("Selected private runtime lacks a participating family"); return null;
      }
      const policy = { schema: 1, evejs: SUPPORTED_EVEJS_VERSION, clientBuild: 3396210, providers };
      policy.revision = crypto.createHash("sha256").update(JSON.stringify(policy)).digest("hex");
      return { bundle, policy: Object.keys(providers).length ? policy : null };
    },
    compose(original) {
      try {
        const selected = state.snapshot();
        return selected ? createDelivery(selected.bundle, () => selected.policy)(original) : original;
      } catch (error) { state.warn("Optional login delivery unavailable"); return original; }
    },
  };
  function shareAutoMiningDelivery(autoMining) {
    try {
      const delivery = autoMining?.delivery;
      if (!delivery || !["object", "function"].includes(typeof delivery)) return false;
      const compose = delivery.compose;
      if (typeof compose !== "function") return false;
      if (delivery[AUTO_MINING_BRIDGE] === state) return true;
      if (delivery[AUTO_MINING_BRIDGE] || !Object.isExtensible(delivery)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(delivery, "compose");
      if (descriptor && (!("value" in descriptor) || descriptor.writable !== true)) return false;
      const wrapped = original => state.compose(compose.call(delivery, original));
      if (!Reflect.defineProperty(delivery, AUTO_MINING_BRIDGE, { value: state, configurable: true })) return false;
      const installed = Reflect.defineProperty(delivery, "compose", descriptor ? { ...descriptor, value: wrapped } : {
        value: wrapped, writable: true, enumerable: true, configurable: true,
      });
      if (!installed || delivery.compose !== wrapped || delivery[AUTO_MINING_BRIDGE] !== state) {
        if (descriptor) Reflect.defineProperty(delivery, "compose", descriptor);
        else Reflect.deleteProperty(delivery, "compose");
        Reflect.deleteProperty(delivery, AUTO_MINING_BRIDGE);
        return false;
      }
      Reflect.defineProperty(delivery, AUTO_MINING_BRIDGE, { value: state, configurable: false });
      return true;
    } catch (_) { return false; }
  }
  const previousCompile = moduleHost.prototype._compile;
  moduleHost.prototype._compile = function privateFittingCompile(content, filename) {
    if (canonical(filename) === target) {
      const legacy = host[Symbol.for("evejs.fittingSimulationCompanion.v1")];
      const autoMining = host[AUTO_MINING_KEY];
      if (legacy?.active) {
        state.warn("Login seam changed/owned (remove legacy companion)");
      } else if (autoMining) {
        if (!shareAutoMiningDelivery(autoMining)) {
          state.warn("AutoMining delivery composition unavailable");
        }
      } else {
        const transformed = extendSource(content);
        if (transformed) { content = transformed; state.transformed = true; }
        else state.warn("Login seam changed/owned");
      }
    }
    return previousCompile.call(this, content, filename);
  };
  return state;
}

function attachMember(runtimeRoot, member, host = globalThis, moduleHost = Module) {
  const key = Symbol.for(KEY);
  const existing = host[key];
  if (existing) {
    if (existing.abi !== 1 || existing.runtimeRoot !== canonical(runtimeRoot) || typeof existing.add !== "function") {
      existing.conflict = true;
      console.warn("[droneClassBalance/simulation] Incompatible private runtime owner; gameplay unaffected.");
      return { active: false, reason: "private-abi-conflict" };
    }
    existing.add(member);
    return existing;
  }
  if (!supportsRoot(runtimeRoot)) return { active: false, reason: "unsupported-evejs" };
  const target = canonical(path.join(runtimeRoot, "server/src/network/tcp/handshake.js"));
  if (Object.keys(moduleHost._cache).some(name => canonical(name) === target)) return { active: false, reason: "handshake-already-loaded" };
  const state = createState(runtimeRoot, host, moduleHost);
  host[key] = state;
  state.add(member);
  return state;
}

module.exports = { attachMember };
