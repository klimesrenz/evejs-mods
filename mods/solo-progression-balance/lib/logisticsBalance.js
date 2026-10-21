"use strict";

const path = require("node:path");

const ATTRIBUTE_CARGO_CAPACITY = 38;
const FLEET_HANGAR_ATTRIBUTE_ID = 912;
const LOGISTICS_SHIP_GROUP_IDS = Object.freeze(new Set([28, 380, 513, 883, 902, 941, 1202]));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function round6(value) {
  const numeric = Number(value);
  return Number(Number.isFinite(numeric) ? numeric.toFixed(6) : 0);
}

function createLogisticsBalance(config, runtimeRoot, options = {}) {
  let cachedSpecialAttributeIDs = null;
  function getSpecialAttributeIDs() {
    if (cachedSpecialAttributeIDs) return cachedSpecialAttributeIDs;
    const definitions = Array.isArray(options.specialHoldDefinitions)
      ? options.specialHoldDefinitions
      : require(path.join(
        runtimeRoot,
        "server/src/services/inventory/specialShipHoldRegistry",
      )).SPECIAL_SHIP_HOLD_DEFINITIONS;
    cachedSpecialAttributeIDs = Object.freeze(
      definitions
        .filter((definition) => definition && !definition.managedBy)
        .flatMap((definition) => definition.attributeIDs || [])
        .map(Number)
        .filter((attributeID) => Number.isInteger(attributeID) && attributeID > 0),
    );
    return cachedSpecialAttributeIDs;
  }
  function resolveShipGroupID(shipItem, shipMetadata) {
    return toInt(shipItem && shipItem.groupID, toInt(shipMetadata && shipMetadata.groupID, 0));
  }
  function isEligibleLogisticsShip(shipItem, shipMetadata) {
    return LOGISTICS_SHIP_GROUP_IDS.has(resolveShipGroupID(shipItem, shipMetadata));
  }
  function applyLogisticsCargoScale(attributes, context = {}) {
    if (
      !attributes ||
      toInt(context.characterID, 0) <= 0 ||
      !isEligibleLogisticsShip(context.shipItem, context.shipMetadata)
    ) {
      return attributes;
    }
    const attributeIDs = [
      ATTRIBUTE_CARGO_CAPACITY,
      FLEET_HANGAR_ATTRIBUTE_ID,
      ...getSpecialAttributeIDs(),
    ];
    for (const attributeID of attributeIDs) {
      if (!Object.prototype.hasOwnProperty.call(attributes, attributeID)) continue;
      const value = Number(attributes[attributeID]);
      if (Number.isFinite(value) && value > 0) {
        attributes[attributeID] = round6(value * config.logisticsCargoScale);
      }
    }
    return attributes;
  }
  return {
    getSpecialAttributeIDs,
    resolveShipGroupID,
    isEligibleLogisticsShip,
    applyLogisticsCargoScale,
  };
}

module.exports = {
  ATTRIBUTE_CARGO_CAPACITY,
  FLEET_HANGAR_ATTRIBUTE_ID,
  LOGISTICS_SHIP_GROUP_IDS,
  createLogisticsBalance,
};
