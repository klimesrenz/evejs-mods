'use strict';
const path=require('node:path');
function createAuthority(root){
  const get=p=>require(path.join(root,'server/src',p));
  const items=get('services/inventory/itemStore'),chars=get('services/character/characterState');
  const locations=get('services/structure/structureLocation'),structures=get('services/structure/structureState'),world=get('space/worldData');
  function identity(s){const id=Number(s?.characterID||s?.charid),c=chars.peekCharacterRecord(id);if(!Number.isSafeInteger(id)||id<=0||!c||c.deletedAt||c.isDeleted)throw Error('CHARACTER_REQUIRED');return id;}
  function exists(id,kind){const row=kind==='structure'?structures.getStructureByID(id):world.getStationByID(id);return !!row&&!row.destroyedAtMs&&!row.destroyedAt;}
  function dock(s,expected){
    const ownerID=identity(s),locationID=locations.getDockedLocationID(s),locationKind=locations.getDockedLocationKind(s);
    if(!locationID||expected&&locationID!==expected)throw Error('DOCK_AT_JOB_LOCATION');
    if(!exists(locationID,locationKind))throw Error('LOCATION_UNAVAILABLE');
    if(locationKind==='structure'&&!structures.canCharacterDockAtStructure(s,structures.getStructureByID(locationID)).success)throw Error('LOCATION_ACCESS_DENIED');
    return {ownerID,locationID,locationKind,flagID:items.ITEM_FLAGS.HANGAR};
  }
  function available(c){
    const stacks=items.listContainerItems(c.ownerID,c.locationID,c.flagID).filter(i=>Number(i.singleton)===0&&!i.custodyReservation).sort((a,b)=>a.itemID-b.itemID),totals=new Map();
    for(const i of stacks){const q=Number(i.stacksize??i.quantity);if(!Number.isSafeInteger(q)||q<=0)throw Error('INVALID_INVENTORY_QUANTITY');const total=(totals.get(i.typeID)||0)+q;if(!Number.isSafeInteger(total))throw Error('INVALID_INVENTORY_QUANTITY');totals.set(i.typeID,total);}
    return {stacks,totals};
  }
  function select(c,inputs){const {stacks}=available(c),requests=[];
    for(const input of inputs){let remaining=input.quantity;for(const i of stacks){if(i.typeID!==input.typeID)continue;const q=Number(i.stacksize??i.quantity),take=Math.min(q,remaining);if(take)requests.push({itemID:i.itemID,quantity:take,expectedTypeID:i.typeID,expectedOwnerID:c.ownerID,expectedLocationID:c.locationID,expectedFlagID:c.flagID,expectedQuantity:q});remaining-=take;if(!remaining)break;}if(remaining)throw Error('INSUFFICIENT_MATERIALS');}
    return requests;
  }
  return {identity,dock,available,select,exists};
}
module.exports={createAuthority};
