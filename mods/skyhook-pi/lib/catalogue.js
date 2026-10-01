"use strict";
function buildCatalogue(planetTypeID, api) {
  const inputs=api.getPlanetResourceTypeIDs(planetTypeID),products=new Map();
  if(!inputs?.length)throw Error('PLANET_RESOURCES_UNAVAILABLE');
  for(const input of inputs) {
    const matches=api.getAllSchematics().filter(s=>s.inputs.length===1 && s.inputs[0].typeID===input && s.outputs.length===1 && api.getCommodityTier(s.outputs[0].typeID)===1);
    const outputs=[...new Set(matches.map(s=>s.outputs[0].typeID))];
    if(outputs.length!==1)throw Error('P1_SCHEMATIC_UNAVAILABLE:'+input);
    const typeID=outputs[0],t=api.getType(typeID);
    if(!t || t.published!==true || !(Number(t.volume)>0))throw Error('P1_TYPE_UNAVAILABLE:'+typeID);
    products.set(typeID,{typeID,name:String(t.name||typeID),volume:Number(t.volume),quantity:0});
  }
  return [...products.values()].sort((a,b)=>a.typeID-b.typeID);
}
module.exports={buildCatalogue};
