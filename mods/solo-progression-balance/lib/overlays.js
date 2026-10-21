"use strict";

const path = require("node:path");

const ATTRIBUTE_MINING_AMOUNT = 77;
const INSTALL_MARK = Symbol.for("evejs.soloProgressionBalance.overlayInstalled");

function installMiningDogma(moduleExports, api) {
  if (!moduleExports || moduleExports[INSTALL_MARK]) return false;
  const original = moduleExports.buildMiningModuleSnapshot;
  if (typeof original !== "function") throw new Error("miningDogma.buildMiningModuleSnapshot missing");
  moduleExports.buildMiningModuleSnapshot = function buildMiningModuleSnapshot(options = {}) {
    return api.scaleMiningModuleSnapshot(original.apply(this, arguments), options);
  };
  Object.defineProperty(moduleExports, INSTALL_MARK, { value: true });
  return true;
}

function installDroneDogma(moduleExports, api) {
  if (!moduleExports || moduleExports[INSTALL_MARK]) return false;
  const originalOperational = moduleExports.resolveDroneOperationalAttributes;
  const originalMining = moduleExports.resolveDroneMiningSnapshot;
  if (typeof originalOperational !== "function" || typeof originalMining !== "function") {
    throw new Error("droneDogma operational/mining exports missing");
  }
  moduleExports.resolveDroneOperationalAttributes = function resolveDroneOperationalAttributes(
    droneEntity,
    controllerEntity,
  ) {
    return api.scaleDroneOperationalAttributes(
      originalOperational.apply(this, arguments),
      controllerEntity,
    );
  };
  moduleExports.resolveDroneMiningSnapshot = function resolveDroneMiningSnapshot(
    droneEntity,
    controllerEntity,
  ) {
    return api.scaleDroneMiningSnapshot(
      originalMining.apply(this, arguments),
      controllerEntity,
    );
  };
  Object.defineProperty(moduleExports, INSTALL_MARK, { value: true });
  return true;
}

function installFittingSnapshotBuilder(moduleExports, runtimeRoot, options = {}) {
  if (!moduleExports || moduleExports[INSTALL_MARK]) return false;
  const original = moduleExports.buildFittingSnapshot;
  if (typeof original !== "function") throw new Error("fittingSnapshotBuilder.buildFittingSnapshot missing");
  moduleExports.buildFittingSnapshot = function buildFittingSnapshot() {
    const snapshot = original.apply(this, arguments);
    if (!snapshot || typeof snapshot.getModuleAttributeOverrides !== "function") return snapshot;
    const originalOverrides = snapshot.getModuleAttributeOverrides;
    const miningDogma = options.miningDogma || require(path.join(
      runtimeRoot,
      "server/src/services/mining/miningDogma",
    ));
    const resolveItemByTypeID = options.resolveItemByTypeID || require(path.join(
      runtimeRoot,
      "server/src/services/inventory/itemTypeRegistry",
    )).resolveItemByTypeID;
    return {
      ...snapshot,
      getModuleAttributeOverrides(moduleItem) {
        const overrides = originalOverrides(moduleItem);
        if (!overrides || !moduleItem) return overrides;
        const chargeItem = (snapshot.fittedItems || []).find((item) => {
          if (!item || Number(item.flagID) !== Number(moduleItem.flagID)) return false;
          const typeRecord = resolveItemByTypeID(item.typeID) || {};
          return Number(item.categoryID || typeRecord.categoryID) === 8;
        }) || null;
        const miningSnapshot = miningDogma.buildMiningModuleSnapshot({
          characterID: snapshot.characterID,
          shipItem: snapshot.shipItem,
          moduleItem,
          effectRecord: null,
          chargeItem,
          fittedItems: snapshot.fittedItems,
          skillMap: snapshot.skillMap,
          activeModuleContexts: snapshot.assumedActiveModuleContexts,
        });
        if (!miningSnapshot) return overrides;
        return {
          ...overrides,
          [ATTRIBUTE_MINING_AMOUNT]: Number(miningSnapshot.miningAmountM3) || 0,
        };
      },
    };
  };
  Object.defineProperty(moduleExports, INSTALL_MARK, { value: true });
  return true;
}

function installDogmaService(DogmaService, api, runtimeRoot, options = {}) {
  if (!DogmaService || typeof DogmaService !== "function" || DogmaService[INSTALL_MARK]) return false;
  const prototype = DogmaService.prototype;
  const original = prototype && prototype._buildInventoryItemAttributes;
  if (typeof original !== "function") throw new Error("DogmaService._buildInventoryItemAttributes missing");
  const spaceRuntime = options.spaceRuntime || require(path.join(runtimeRoot, "server/src/space/runtime"));
  const marshal = options.marshal || DogmaService._testing && DogmaService._testing.marshalDogmaAttributeValue;
  if (typeof marshal !== "function") throw new Error("DogmaService marshalDogmaAttributeValue missing");
  prototype._buildInventoryItemAttributes = function _buildInventoryItemAttributes(
    item,
    session = null,
  ) {
    const attributes = original.apply(this, arguments);
    const characterID = Number(this._getCharID(session)) || 0;
    const shipID = Number(this._getShipID(session)) || 0;
    if (
      !attributes || !session || !item || characterID <= 0 || shipID <= 0 ||
      Number(item.categoryID) !== 18 || Number(item.flagID) !== 0 ||
      Number(item.ownerID) !== characterID ||
      !spaceRuntime || typeof spaceRuntime.getSceneForSession !== "function"
    ) {
      return attributes;
    }
    const scene = spaceRuntime.getSceneForSession(session);
    if (!scene || typeof scene.getEntityByID !== "function" || typeof scene.getShipEntityForSession !== "function") {
      return attributes;
    }
    const runtimeEntity = scene.getEntityByID(Number(item.itemID) || 0);
    const controllerEntity = scene.getShipEntityForSession(session);
    const droneDogma = options.droneDogma || require(path.join(
      runtimeRoot,
      "server/src/services/drone/droneDogma",
    ));
    const overrides = api.buildLiveMiningDroneItemInfoAttributeOverrides({
      item,
      runtimeEntity,
      controllerEntity,
      operationalAttributes: runtimeEntity && controllerEntity
        ? droneDogma.resolveDroneOperationalAttributes(runtimeEntity, controllerEntity)
        : null,
      characterID,
      shipID,
    });
    const amount = Number(overrides && overrides[ATTRIBUTE_MINING_AMOUNT]);
    if (Number.isFinite(amount) && amount > 0) {
      attributes[ATTRIBUTE_MINING_AMOUNT] = marshal(ATTRIBUTE_MINING_AMOUNT, amount);
    }
    return attributes;
  };
  Object.defineProperty(DogmaService, INSTALL_MARK, { value: true });
  return true;
}

module.exports = {
  installDogmaService,
  installDroneDogma,
  installFittingSnapshotBuilder,
  installMiningDogma,
};
