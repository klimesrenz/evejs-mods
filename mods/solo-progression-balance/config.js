"use strict";

const fs = require("node:fs");
const path = require("node:path");

const KEYS = Object.freeze({
  enabled: "EVEJS_SOLO_PROGRESSION_BALANCE",
  miningYieldScale: "EVEJS_SOLO_MINING_YIELD_SCALE",
  miningDroneYieldScale: "EVEJS_SOLO_MINING_DRONE_YIELD_SCALE",
  miningHoldScale: "EVEJS_SOLO_MINING_HOLD_SCALE",
  logisticsCargoScale: "EVEJS_SOLO_LOGISTICS_CARGO_SCALE",
  verbose: "EVEJS_SOLO_PROGRESSION_BALANCE_VERBOSE",
});
const DEFAULTS = Object.freeze({
  enabled: false, miningYieldScale: 3, miningDroneYieldScale: 3,
  miningHoldScale: 3, logisticsCargoScale: 2, verbose: false,
});
const MIN_SCALE = 0.01;
const MAX_SCALE = 100;

function readEnvFile(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (_) { return {}; }
  const result = {};
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (value.length >= 2 && ["\"", "'"].includes(value[0]) && value.endsWith(value[0])) value = value.slice(1, -1);
    if (key) result[key] = value;
  }
  return result;
}

function readBoolean(value, fallback) {
  if (value == null || String(value).trim() === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return fallback;
}

function readSettings(modDir) {
  const file = path.join(modDir, "settings.json");
  if (!fs.existsSync(file)) return {};
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Solo settings.json must contain an object");
  for (const key of Object.keys(value)) if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) throw new Error(`Unknown Solo setting: ${key}`);
  return value;
}

function load(modDir, environment = process.env) {
  const fileValues = readEnvFile(path.join(modDir, ".env"));
  const settings = readSettings(modDir);
  const pick = (name) => {
    const envKey = KEYS[name];
    if (environment[envKey] != null && String(environment[envKey]).trim() !== "") return environment[envKey];
    if (Object.prototype.hasOwnProperty.call(settings, name)) return settings[name];
    return fileValues[envKey];
  };
  const problems = [];
  const readScale = (name) => {
    const raw = pick(name);
    if (raw == null || String(raw).trim() === "") return DEFAULTS[name];
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric < MIN_SCALE || numeric > MAX_SCALE) {
      problems.push(`${name} must be between ${MIN_SCALE} and ${MAX_SCALE}`);
      return DEFAULTS[name];
    }
    return numeric;
  };
  return Object.freeze({
    enabled: readBoolean(pick("enabled"), DEFAULTS.enabled),
    miningYieldScale: readScale("miningYieldScale"),
    miningDroneYieldScale: readScale("miningDroneYieldScale"),
    miningHoldScale: readScale("miningHoldScale"),
    logisticsCargoScale: readScale("logisticsCargoScale"),
    verbose: readBoolean(pick("verbose"), DEFAULTS.verbose),
    problems: Object.freeze(problems),
  });
}

module.exports = { DEFAULTS, KEYS, load, readBoolean, readEnvFile, readSettings };
