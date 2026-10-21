"use strict";

const { createMiningBalance } = require("./miningBalance");
const { createLogisticsBalance } = require("./logisticsBalance");
const {
  buildMiningModuleClientAttributeOverrides,
  buildMiningDroneClientAttributeOverrides,
  buildLiveMiningDroneItemInfoAttributeOverrides,
  mergeMiningDroneClientAttributeOverrides,
} = require("./clientSync");

function createRuntimeApi(config, runtimeRoot, options = {}) {
  const mining = createMiningBalance(config);
  const logistics = createLogisticsBalance(config, runtimeRoot, options);
  return Object.freeze({
    config,
    ...mining,
    ...logistics,
    applyShipCapacityScales(attributes, context = {}) {
      logistics.applyLogisticsCargoScale(attributes, context);
      mining.applyMiningHoldScale(attributes, context);
      return attributes;
    },
    applyMiningModuleClientSync(characterID, isMiningModule, attributes) {
      if (Number(characterID) <= 0 || isMiningModule !== true) return attributes;
      const overrides = buildMiningModuleClientAttributeOverrides(
        attributes,
        mining.scaleMiningYield,
      );
      return overrides ? { ...(attributes || {}), ...overrides } : attributes;
    },
    buildMiningDroneClientAttributeOverrides,
    buildLiveMiningDroneItemInfoAttributeOverrides,
    mergeMiningDroneClientAttributeOverrides,
  });
}

module.exports = { createRuntimeApi };
