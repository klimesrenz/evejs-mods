"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { validateRoot, createDelivery } = require("./lib/delivery");
const ACTIONS = new Set(["install", "verify", "prepare_profile", "prepare_disable", "prepare_remove", "recover"]);
function execute(request) {
  if (!ACTIONS.has(request.action)) throw Error("Unsupported Market Search helper action.");
  const removing = ["prepare_disable", "prepare_remove"].includes(request.action);
  if (!removing) {
    if ((request.runtime.backend || "native") !== "native") throw Error("Market Search 0.1.4 supports Native only.");
    if (Number(process.versions.node.split(".")[0]) < 24) throw Error("Node.js 24+ is required.");
    const root = request.runtime.evejsRoot || request.mod.root;
    validateRoot(root);
    createDelivery(path.resolve(request.mod.path));
  }
  return {
    protocol: request.protocol, requestId: request.requestId, success: true, state: "ready",
    message: removing ? "Restart server and all clients to unload Market Search." : "Market Search uses login delivery. Restart server and clients after enabling.",
    restartRequired: [], contributions: [], environment: {}, arguments: []
  };
}
if (require.main === module) {
  function arg(name) { const index = process.argv.indexOf(name); if (index < 0 || !process.argv[index + 1]) throw Error(`Missing ${name}`); return process.argv[index + 1]; }
  try {
    const request = JSON.parse(fs.readFileSync(arg("--request"), "utf8"));
    let result;
    try { result = execute(request); }
    catch (error) { result = { protocol: request.protocol, requestId: request.requestId, success: false, state: "failed", message: String(error.message).slice(0, 1500), restartRequired: [], contributions: [], environment: {}, arguments: [] }; }
    fs.writeFileSync(arg("--result"), JSON.stringify(result));
    if (!result.success) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { execute };
