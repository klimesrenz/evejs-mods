'use strict';
const MAX_QUANTITY = 2147483647;
function positive(value) { if (!Number.isSafeInteger(value) || value <= 0) throw Error('INVALID_QUANTITY'); return value; }
function buildCatalogue(api) {
  const rows = [];
  for (const s of api.getAllSchematics()) {
    if (!s.outputs?.length || !s.outputs.every(o => [2,3,4].includes(api.getCommodityTier(o.typeID)))) continue;
    if (!s.inputs?.length || s.outputs.length !== 1) throw Error('INVALID_PI_SCHEMATIC');
    const entries = list => list.map(e => {
      positive(e.typeID); positive(e.quantity);
      const type = api.getType(e.typeID);
      if (!type || type.published === false) throw Error('PI_TYPE_UNAVAILABLE:'+e.typeID);
      return {typeID:e.typeID, quantity:e.quantity};
    });
    rows.push({schematicID:positive(s.schematicID),tier:api.getCommodityTier(s.outputs[0].typeID),
      name:String(api.getType(s.outputs[0].typeID)?.name || s.outputs[0].typeID),
      cycleMs:positive(s.cycleTime * 1000),inputs:entries(s.inputs),outputs:entries(s.outputs)});
  }
  if (!rows.length) throw Error('PI_SCHEMATICS_UNAVAILABLE');
  return rows.sort((a,b)=>a.tier-b.tier || a.schematicID-b.schematicID);
}
function quoteRecipe(recipe, batches, available) {
  positive(batches);
  const maxBatches = Math.max(0, Math.min(
    ...recipe.inputs.map(e => Math.floor((available.get(e.typeID)||0)/positive(e.quantity))),
    ...[...recipe.inputs,...recipe.outputs].map(e => Math.floor(MAX_QUANTITY/e.quantity))));
  if (batches > maxBatches) throw Error('INSUFFICIENT_MATERIALS_OR_QUANTITY_LIMIT');
  const scale = list => list.map(e => ({typeID:e.typeID,quantity:positive(e.quantity*batches)}));
  return {inputs:scale(recipe.inputs),outputs:scale(recipe.outputs),batches,durationMs:positive(recipe.cycleMs),maxBatches};
}
module.exports={buildCatalogue,quoteRecipe,positive,MAX_QUANTITY};
