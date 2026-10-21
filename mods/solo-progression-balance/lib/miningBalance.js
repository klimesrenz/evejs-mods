"use strict";

const ATTRIBUTE_MINING_AMOUNT = 77;
const MINING_HOLD_ATTRIBUTE_IDS = Object.freeze([1556, 1557, 3136, 3227]);

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function round6(value) {
  return Number(toFiniteNumber(value, 0).toFixed(6));
}

function scalePositiveValue(value, scale) {
  const numeric = toFiniteNumber(value, 0);
  return numeric > 0 ? round6(numeric * scale) : numeric;
}

function controllerCharacterID(controllerEntity) {
  return Number(
    controllerEntity && controllerEntity.session && controllerEntity.session.characterID ||
    controllerEntity && (
      controllerEntity.pilotCharacterID ??
      controllerEntity.characterID ??
      controllerEntity.ownerID
    ),
  ) || 0;
}

function createMiningBalance(config) {
  function scaleMiningYield(value) {
    return scalePositiveValue(value, config.miningYieldScale);
  }
  function scaleMiningDroneYield(value) {
    return scalePositiveValue(value, config.miningDroneYieldScale);
  }
  function scaleMiningHoldCapacity(value) {
    return scalePositiveValue(value, config.miningHoldScale);
  }
  function scaleMiningModuleSnapshot(snapshot, options = {}) {
    if (!snapshot || Number(options.characterID) <= 0) return snapshot;
    const amount = toFiniteNumber(snapshot.miningAmountM3, 0);
    if (amount <= 0) return snapshot;
    const scaled = scaleMiningYield(amount);
    return {
      ...snapshot,
      miningAmountM3: scaled,
      moduleAttributes: {
        ...(snapshot.moduleAttributes || {}),
        [ATTRIBUTE_MINING_AMOUNT]: scaled,
      },
    };
  }
  function scaleDroneOperationalAttributes(attributes, controllerEntity) {
    const amount = toFiniteNumber(attributes && attributes[ATTRIBUTE_MINING_AMOUNT], 0);
    if (!attributes || controllerCharacterID(controllerEntity) <= 0 || amount <= 0) return attributes;
    return {
      ...attributes,
      [ATTRIBUTE_MINING_AMOUNT]: scaleMiningDroneYield(amount),
    };
  }
  function scaleDroneMiningSnapshot(snapshot, controllerEntity) {
    const amount = toFiniteNumber(snapshot && snapshot.miningAmountM3, 0);
    if (!snapshot || controllerCharacterID(controllerEntity) <= 0 || amount <= 0) return snapshot;
    return { ...snapshot, miningAmountM3: scaleMiningDroneYield(amount) };
  }
  function applyMiningHoldScale(attributes, context = {}) {
    if (!attributes || Number(context.characterID) <= 0) return attributes;
    for (const attributeID of MINING_HOLD_ATTRIBUTE_IDS) {
      if (Object.prototype.hasOwnProperty.call(attributes, attributeID)) {
        attributes[attributeID] = scaleMiningHoldCapacity(attributes[attributeID]);
      }
    }
    return attributes;
  }
  return {
    scaleMiningYield,
    scaleMiningDroneYield,
    scaleMiningHoldCapacity,
    scaleMiningModuleSnapshot,
    scaleDroneOperationalAttributes,
    scaleDroneMiningSnapshot,
    applyMiningHoldScale,
  };
}

module.exports = {
  ATTRIBUTE_MINING_AMOUNT,
  MINING_HOLD_ATTRIBUTE_IDS,
  createMiningBalance,
  round6,
  scalePositiveValue,
};
