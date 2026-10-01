"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function databasePath(root) {
  const override = path.join(root, "config/market-search.config.json");
  if (fs.existsSync(override)) {
    const config = JSON.parse(fs.readFileSync(override, "utf8").replace(/^\uFEFF/, ""));
    if (typeof config.databasePath !== "string" || !config.databasePath.trim()) throw Error("market-search.config.json requires databasePath");
    return path.resolve(root, config.databasePath);
  }
  const daemon = path.join(root, "externalservices/market-server");
  const config = fs.readFileSync(path.join(daemon, "config/market-server.local.toml"), "utf8");
  const section = config.match(/^\[storage\][\s\S]*?(?=^\[|$(?![\s\S]))/m);
  const match = section && section[0].match(/^\s*database_path\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/m);
  if (!match) throw Error("Cannot read market database_path; set config/market-search.config.json");
  const value = match[1][0] === '"' ? JSON.parse(match[1]) : match[1].slice(1, -1);
  return path.resolve(daemon, value);
}

function query(root, input) {
  const text = String(input || "").trim();
  if (text.length < 1 || text.length > 120) throw Error("Enter a type ID or 2–120 characters of the English item name.");
  const isID = /^\d+$/.test(text);
  if (isID && (!Number.isSafeInteger(Number(text)) || Number(text) < 1 || Number(text) > 4294967295)) throw Error("Invalid type ID.");
  if (!isID && text.length < 2) throw Error("Enter at least two characters.");
  const file = databasePath(root);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw Error("Market database not found; check config/market-search.config.json.");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 3000; BEGIN");
    const types = isID
      ? db.prepare("SELECT type_id AS typeID, name FROM market_types WHERE type_id = ?").all(Number(text))
      : db.prepare("SELECT type_id AS typeID, name FROM market_types WHERE instr(lower(name), lower(?)) > 0 ORDER BY lower(name) = lower(?) DESC, name LIMIT 51").all(text, text);
    const exact = types.find(type => type.name.toLowerCase() === text.toLowerCase());
    const chosen = isID ? types[0] : exact || (types.length === 1 ? types[0] : null);
    if (!chosen) return { types: types.slice(0, 50), moreTypes: types.length > 50, offers: [] };
    // Only public NPC station locations. Group volume at the best ask, never
    // pretend that higher-priced stock is available at that price.
    const offers = db.prepare(`WITH sells AS (
      SELECT station_id, type_id, price, quantity FROM seed_stock
      WHERE type_id = ? AND quantity > 0 AND price > 0
      UNION ALL
      SELECT station_id, type_id, price, vol_remaining FROM market_orders
      WHERE type_id = ? AND state = 'open' AND bid = 0 AND vol_remaining > 0 AND price > 0
    ), best AS (
      SELECT o.station_id, MIN(o.price) AS price FROM sells o
      JOIN stations s ON s.station_id = o.station_id GROUP BY o.station_id
    )
    SELECT s.station_id AS stationID, s.station_name AS stationName,
      s.solar_system_id AS systemID, COALESCE(y.solar_system_name, '') AS systemName,
      s.region_id AS regionID, COALESCE(r.region_name, '') AS regionName,
      b.price, SUM(o.quantity) AS quantity
    FROM best b JOIN sells o ON o.station_id = b.station_id AND o.price = b.price
      JOIN stations s ON s.station_id = b.station_id
      LEFT JOIN solar_systems y ON y.solar_system_id = s.solar_system_id
      LEFT JOIN regions r ON r.region_id = s.region_id
    GROUP BY s.station_id ORDER BY b.price, s.station_id LIMIT 10001`).all(chosen.typeID, chosen.typeID);
    if (offers.length > 10000) throw Error("More than 10000 stations; result too large.");
    return { types: [chosen], item: chosen, moreTypes: false, offers };
  } finally {
    db.close(); // Closing a read transaction releases its snapshot, without writes.
  }
}
module.exports = { databasePath, query };
