"use strict";

const { ATTRIBUTE_MINING_AMOUNT } = require("./miningBalance");

const DRONE_CATEGORY_ID = 18;
const IN_SPACE_FLAG_ID = 0;

function buildMiningModuleClientAttributeOverrides(effectiveAttributes, scaleMiningYield) {
  const amount = Number(effectiveAttributes && effectiveAttributes[ATTRIBUTE_MINING_AMOUNT]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { [ATTRIBUTE_MINING_AMOUNT]: scaleMiningYield(amount) };
}

function buildMiningDroneClientAttributeOverrides(operationalAttributes) {
  const amount = Number(operationalAttributes && operationalAttributes[ATTRIBUTE_MINING_AMOUNT]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { [ATTRIBUTE_MINING_AMOUNT]: amount };
}

function mergeMiningDroneClientAttributeOverrides(
  resolvedAttributes,
  operationalAttributes,
) {
  if (!resolvedAttributes || typeof resolvedAttributes !== "object") {
    return resolvedAttributes;
  }
  const soloOverrides = buildMiningDroneClientAttributeOverrides(
    operationalAttributes,
  );
  return soloOverrides
    ? { ...resolvedAttributes, ...soloOverrides }
    : resolvedAttributes;
}

function buildLiveMiningDroneItemInfoAttributeOverrides(context = {}) {
  const item = context.item || null;
  const runtimeEntity = context.runtimeEntity || null;
  const controllerEntity = context.controllerEntity || null;
  const characterID = Number(context.characterID) || 0;
  const shipID = Number(context.shipID) || 0;
  const itemID = Number(item && item.itemID) || 0;
  const typeID = Number(item && item.typeID) || 0;
  const systemID = Number(item && item.locationID) || 0;
  const controllerCharacterID = Number(
    controllerEntity && (
      controllerEntity.pilotCharacterID ??
      controllerEntity.characterID ??
      controllerEntity.ownerID
    ),
  ) || 0;
  if (
    characterID <= 0 || shipID <= 0 || itemID <= 0 || typeID <= 0 || systemID <= 0 ||
    !runtimeEntity || !controllerEntity ||
    Number(item.categoryID) !== DRONE_CATEGORY_ID ||
    Number(item.flagID) !== IN_SPACE_FLAG_ID ||
    Number(item.ownerID) !== characterID ||
    runtimeEntity.kind !== "drone" ||
    Number(runtimeEntity.categoryID) !== DRONE_CATEGORY_ID ||
    Number(runtimeEntity.itemID) !== itemID ||
    Number(runtimeEntity.typeID) !== typeID ||
    Number(runtimeEntity.ownerID) !== characterID ||
    Number(runtimeEntity.controllerID) !== shipID ||
    Number(runtimeEntity.controllerOwnerID) !== characterID ||
    Number(runtimeEntity.systemID) !== systemID ||
    controllerEntity.kind !== "ship" ||
    Number(controllerEntity.itemID) !== shipID ||
    controllerCharacterID !== characterID ||
    Number(controllerEntity.systemID) !== systemID
  ) {
    return null;
  }
  const attributes = Object.prototype.hasOwnProperty.call(context, "operationalAttributes")
    ? context.operationalAttributes
    : runtimeEntity.passiveDerivedState && runtimeEntity.passiveDerivedState.attributes;
  return buildMiningDroneClientAttributeOverrides(attributes);
}

module.exports = {
  ATTRIBUTE_MINING_AMOUNT,
  DRONE_CATEGORY_ID,
  IN_SPACE_FLAG_ID,
  buildMiningModuleClientAttributeOverrides,
  buildMiningDroneClientAttributeOverrides,
  buildLiveMiningDroneItemInfoAttributeOverrides,
  mergeMiningDroneClientAttributeOverrides,
};
