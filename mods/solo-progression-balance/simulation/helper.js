"use strict";
const fs = require("node:fs");
const path = require("node:path");
const ACTIONS = new Set(["install", "verify", "prepare_profile", "prepare_disable", "prepare_remove", "recover"]);
function execute(request, features = process.env.EVEJS_LAUNCHER_HELPER_FEATURES || "", modRoot = path.resolve(__dirname, "..")) {
  if (!ACTIONS.has(request.action)) throw Error("Unsupported helper action");
  const supportedHost = features.split(",").includes("client-script-delivery-v1");
  const cleanup = ["prepare_disable", "prepare_remove"].includes(request.action);
  let available = false;
  let message = "SoloProgressionBalance gameplay ready. Simulation unavailable; native simulation retained.";
  try {
    const capability = require("./capability");
    if (cleanup) {
      capability.clear(modRoot);
      message = "Restart server and reconnect clients to disable SoloProgressionBalance; no vendor client files require restoration.";
    } else {
      const { supportsRoot, readBundle } = require("./delivery");
      const bundle = readBundle(path.join(modRoot, "simulation"));
      let compatible = false;
      try {
        const ini = fs.readFileSync(path.join(request.runtime.clientRoot, "start.ini"), "utf8");
        compatible = supportedHost && request.runtime.backend === "native" && supportsRoot(request.runtime.evejsRoot) &&
          /^build\s*=\s*3396210\s*$/m.test(ini.replace(/\r/g, ""));
      } catch (_) { /* Optional preflight cannot block gameplay. */ }
      capability.record(modRoot, request.runtime.evejsRoot, bundle, compatible);
      available = compatible;
      if (available) message = "SoloProgressionBalance gameplay and transient fitting simulation ready; no separate companion required.";
    }
  } catch (error) {
    try { fs.rmSync(path.join(modRoot, "_local/simulation-capability.json"), { force: true }); } catch (_) { /* Do not block gameplay or removal. */ }
    message += " Optional simulation preflight: " + error.message;
  }
  const result = { protocol: request.protocol, requestId: request.requestId, success: true, state: "ready", message,
    restartRequired: [], contributions: [], environment: {}, arguments: [] };
  if (supportedHost) result.clientScriptDelivery = available ? "login-handshake" : "none";
  return result;
}
if (require.main === module) {
  const arg = name => process.argv[process.argv.indexOf(name) + 1];
  const request = JSON.parse(fs.readFileSync(arg("--request"), "utf8"));
  const result = execute(request);
  fs.writeFileSync(arg("--result"), JSON.stringify(result));
}
module.exports = { execute };
