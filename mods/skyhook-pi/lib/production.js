"use strict";
const DEFAULTS = Object.freeze({amountPerCycle:20, cycleMs:300000, capacityPerProduct:40320});
function positive(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw Error(`INVALID_${name}`);
  return value;
}
function config(input = {}) {
  const result = {};
  for (const [key,value] of Object.entries(DEFAULTS)) result[key] = positive(input[key] ?? value,key);
  if (result.cycleMs < 1000 || result.amountPerCycle > 1000000000 || result.capacityPerProduct > 1000000000) throw Error('CONFIG_LIMIT');
  return result;
}
function advance(source, nowMs) {
  const row = structuredClone(source);
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || !Number.isSafeInteger(row.lastCycleMs)) throw Error('INVALID_TIME');
  if (row.status !== 'running' || nowMs < row.lastCycleMs) return row;
  const cfg = config(row.config);
  const cycles = Math.floor((nowMs-row.lastCycleMs)/cfg.cycleMs);
  for (const p of row.products) {
    if (!Number.isSafeInteger(p.quantity) || p.quantity<0) throw Error('INVALID_STOCK');
    const room = Math.max(0,cfg.capacityPerProduct-p.quantity);
    p.quantity += cycles >= Math.ceil(room/cfg.amountPerCycle) ? room : cycles*cfg.amountPerCycle;
  }
  row.lastCycleMs += cycles*cfg.cycleMs;
  return row;
}
module.exports={DEFAULTS,config,advance,positive};
