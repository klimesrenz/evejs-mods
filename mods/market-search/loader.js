"use strict";
const path = require("node:path");
const Module = require("node:module");
const { isMainThread } = require("node:worker_threads");
const { validateRoot, createDelivery, installPacketHook } = require("./lib/delivery");
const { createSearch } = require("./lib/search");
const KEY = Symbol.for("evejs.market-search.loader.v1");
const canonical = file => process.platform === "win32" ? path.resolve(file).toLowerCase() : path.resolve(file);
function command(value) {
  const match = typeof value === "string" && value.trim().match(/^[!/]marketfind(?:\s+(.{0,120}))?$/i);
  return match ? (match[1] || "").trim() : null;
}
function install(root = path.resolve(__dirname, "../..")) {
  if (!isMainThread || globalThis[KEY]) return globalThis[KEY];
  validateRoot(root);
  // Node preloads run before services capture destructured method references.
  // Refuse late loading, instead of pretending the UI/RPC hooks attached.
  const files = new Map([
    [canonical(path.join(root, "server/src/network/tcp/utils/marshal.js")), "packet"],
    [canonical(path.join(root, "server/src/services/market/marketProxyService.js")), "rpc"],
    [canonical(path.join(root, "server/src/services/chat/chatCommands.js")), "chat"],
    [canonical(path.join(root, "server/src/_secondary/chat/chatRuntime.js")), "plain"],
  ]);
  for (const cached of Object.keys(require.cache)) if (files.has(canonical(cached))) throw Error("Market Search must be loaded through the Launcher before server startup.");
  const compose = createDelivery(__dirname);
  const search = createSearch(root);
  const clients = new WeakSet();
  const seen = new WeakSet();
  function open(session, query) {
    if (!session || !Number(session.characterID || session.charid)) return "Select a character first.";
    if (!clients.has(session)) return "Market Search UI is not ready. Restart the client through the Launcher; check server logs for [MarketSearch].";
    session.sendNotification("OnMarketSearchOpen", "clientID", [query]);
    return "Market Search opened.";
  }
  const previousLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    const exports = previousLoad.apply(this, arguments);
    if (!exports || !["object", "function"].includes(typeof exports) || Module.isBuiltin(request)) return exports;
    let kind;
    try { kind = files.get(canonical(Module._resolveFilename(request, parent, isMain))); } catch { return exports; }
    if (!kind || seen.has(exports)) return exports;
    if (kind === "packet" && typeof exports.encodePacket === "function") installPacketHook(exports, compose);
    else if (kind === "rpc" && typeof exports.prototype?.Handle_GetOrders === "function") {
      exports.prototype.Handle_MarketSearchReady = function(args, session) {
        const valid = session && Number(session.characterID || session.charid) > 0;
        if (valid) clients.add(session);
        return JSON.stringify({ success: !!valid, version: "0.1.3" });
      };
      exports.prototype.Handle_MarketSearchFind = search;
    } else if (kind === "chat" && typeof exports.executeChatCommand === "function") {
      const original = exports.executeChatCommand;
      exports.executeChatCommand = function(session, message, hub, options = {}) {
        const query = command(message);
        if (query === null) return original.apply(this, arguments);
        const reply = open(session, query);
        if (hub && options.emitChatFeedback !== false) hub.sendSystemMessage(session, reply, options.feedbackChannel || options.channel || null);
        return { handled: true, message: reply };
      };
      if (Array.isArray(exports.AVAILABLE_SLASH_COMMANDS) && !exports.AVAILABLE_SLASH_COMMANDS.includes("marketfind")) exports.AVAILABLE_SLASH_COMMANDS.push("marketfind");
    } else if (kind === "plain" && typeof exports.broadcastLocalMessage === "function") {
      for (const [name, index] of [["broadcastLocalMessage", 1], ["sendChannelMessage", 2]]) {
        const original = exports[name];
        if (typeof original !== "function") continue;
        exports[name] = function(...args) {
          const query = command(args[index]);
          if (query === null) return original.apply(this, args);
          // Same private command feedback boundary used by AutoMining.
          throw Error(open(args[0], query));
        };
      }
    } else return exports;
    seen.add(exports);
    console.log(`[MarketSearch] Attached ${kind}.`);
    return exports;
  };
  globalThis[KEY] = { active: true };
  console.log("[MarketSearch] 0.1.3 loaded. /marketfind or !marketfind opens the in-game window.");
  return globalThis[KEY];
}
module.exports = { install, command };
try { install(); } catch (error) { console.error(`[MarketSearch] Inactive: ${error.message}`); }
