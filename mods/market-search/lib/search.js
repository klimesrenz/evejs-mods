"use strict";
const path = require("node:path");
const { Worker } = require("node:worker_threads");

function text(value) {
  if (value && ["wstring", "token", "rawstr"].includes(value.type)) value = value.value;
  if (Buffer.isBuffer(value)) value = value.length <= 480 ? value.toString("utf8") : null;
  if (typeof value !== "string" || value.length > 120) throw Error("Invalid search text.");
  return value.trim();
}
function createSearch(root) {
  let graph = null;
  const busy = new Set();
  function distances(source) {
    if (!graph) {
      const world = require(path.join(root, "server/src/space/worldData.js"));
      const next = new Map();
      for (const system of world.getSolarSystems()) next.set(Number(system.solarSystemID), new Set());
      for (const id of next.keys()) {
        for (const gate of world.getStargatesForSystem(id)) {
          const destination = Number(gate.destinationSolarSystemID);
          if (next.has(destination)) { next.get(id).add(destination); next.get(destination).add(id); }
        }
      }
      graph = next;
    }
    if (!graph.has(source)) throw Error("Current solar system is not in the stargate map.");
    const hops = new Map([[source, 0]]), queue = [source];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const id = queue[cursor];
      for (const destination of graph.get(id)) {
        if (!hops.has(destination)) { hops.set(destination, hops.get(id) + 1); queue.push(destination); }
      }
    }
    return hops;
  }
  function read(query) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, "worker.js"), { workerData: { root, query } });
      let finished = false;
      const timer = setTimeout(() => finish(Error("Market search timed out.")), 15000);
      function finish(error, result) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        void worker.terminate();
        error ? reject(error) : resolve(result);
      }
      worker.once("message", result => finish(null, result));
      worker.once("error", error => finish(error));
      worker.once("exit", code => { if (!finished) finish(Error(`Market search worker exited (${code}).`)); });
    });
  }
  return async function search(args, session) {
    const characterID = Number(session?.characterID || session?.charid);
    if (!Number.isSafeInteger(characterID) || characterID <= 0) return JSON.stringify({ success: false, message: "Select a character first." });
    if (busy.has(characterID) || busy.size >= 4) return JSON.stringify({ success: false, message: "Search is busy; try again shortly." });
    busy.add(characterID);
    try {
      const query = text(args?.[0]);
      const sourceSystemID = Number(session.solarSystemID || session.solarsystemid2 || session.solarsystemid);
      if (!Number.isSafeInteger(sourceSystemID) || sourceSystemID <= 0) throw Error("Current solar system is unavailable.");
      const result = await read(query);
      if (!result.success) return JSON.stringify(result);
      const hops = result.offers.length ? distances(sourceSystemID) : new Map();
      for (const row of result.offers) row.jumps = hops.has(row.systemID) ? hops.get(row.systemID) : null;
      return JSON.stringify({ ...result, characterID, sourceSystemID });
    } catch (error) {
      return JSON.stringify({ success: false, message: String(error.message).slice(0, 500) });
    } finally {
      busy.delete(characterID);
    }
  };
}
module.exports = { createSearch, text };
