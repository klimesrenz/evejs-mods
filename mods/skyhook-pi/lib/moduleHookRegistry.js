"use strict";

const Module = require("node:module");

const LOAD_REGISTRY = Symbol.for("evejs.mod-hooks.load.v1");
const EXTENSION_REGISTRY = Symbol.for("evejs.mod-hooks.extension.v1");

function registerLoadHook(handler) {
  let registry = globalThis[LOAD_REGISTRY];
  if (!registry) {
    const previous = Module._load;
    const handlers = [];
    const dispatch = function(request, parent, isMain) {
      if (handlers.length === 0 && Module._load === dispatch) {
        Module._load = previous;
        delete globalThis[LOAD_REGISTRY];
        return previous.apply(this, arguments);
      }
      let exports = previous.apply(this, arguments);
      for (const entry of [...handlers]) {
        if (entry.active) exports = entry.handler.call(this, exports, request, parent, isMain);
      }
      return exports;
    };
    registry = { previous, handlers, dispatch };
    globalThis[LOAD_REGISTRY] = registry;
    Module._load = dispatch;
  }
  const entry = { active: true, handler };
  registry.handlers.push(entry);
  return function unregister() {
    if (!entry.active) return;
    entry.active = false;
    const index = registry.handlers.indexOf(entry);
    if (index >= 0) registry.handlers.splice(index, 1);
    if (registry.handlers.length === 0 && Module._load === registry.dispatch) {
      Module._load = registry.previous;
      delete globalThis[LOAD_REGISTRY];
    }
  };
}

function registerExtensionHook(extension, handler) {
  let registries = globalThis[EXTENSION_REGISTRY];
  if (!registries) {
    registries = new Map();
    globalThis[EXTENSION_REGISTRY] = registries;
  }
  let registry = registries.get(extension);
  if (!registry) {
    const previous = Module._extensions[extension];
    const handlers = [];
    const dispatch = function(mod, filename) {
      if (handlers.length === 0 && Module._extensions[extension] === dispatch) {
        Module._extensions[extension] = previous;
        registries.delete(extension);
        if (registries.size === 0) delete globalThis[EXTENSION_REGISTRY];
        return previous.call(this, mod, filename);
      }
      const context = this;
      let index = 0;
      function next() {
        while (index < handlers.length) {
          const entry = handlers[index++];
          if (entry.active) return entry.handler.call(context, next, mod, filename);
        }
        return previous.call(context, mod, filename);
      }
      return next();
    };
    registry = { previous, handlers, dispatch };
    registries.set(extension, registry);
    Module._extensions[extension] = dispatch;
  }
  const entry = { active: true, handler };
  registry.handlers.push(entry);
  return function unregister() {
    if (!entry.active) return;
    entry.active = false;
    const index = registry.handlers.indexOf(entry);
    if (index >= 0) registry.handlers.splice(index, 1);
    if (registry.handlers.length === 0 && Module._extensions[extension] === registry.dispatch) {
      Module._extensions[extension] = registry.previous;
      registries.delete(extension);
      if (registries.size === 0) delete globalThis[EXTENSION_REGISTRY];
    }
  };
}

module.exports = { registerExtensionHook, registerLoadHook };
