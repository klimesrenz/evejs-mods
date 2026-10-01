"use strict";
const path=require('node:path');
function createAuthority(root){
 const get=p=>require(path.join(root,'server/src',p));
 const items=get('services/inventory/itemStore'),orbitals=get('services/planet/planetOrbitalState');
 const characters=get('services/character/characterState'),corps=get('services/corporation/corporationState'),roles=get('services/corporation/corporationRuntimeState');
 const holds=get('services/inventory/specialShipHoldRegistry'),fitting=get('_secondary/fitting/fittingRuntime');
 const live=get('services/fitting/liveFittingState'),space=get('space/runtime');
 const maxDistance=get('services/ship/cargoContainerRuntime').MAX_CARGO_CONTAINER_TRANSFER_DISTANCE_METERS;
 function identity(s){
  const characterID=Number(s?.characterID||s?.charid),c=characters.peekCharacterRecord(characterID);
  const corpID=Number(c?.corporationID),corp=corps.getCorporationRecord(corpID);
  if(!c||c.deletedAt||c.isDeleted||!corp||corp.isNPC!==false)throw Error('PLAYER_CORPORATION_REQUIRED');
  return {characterID,corpID};
 }
 function anchor(id){
  const item=items.findItemById(id),r=orbitals.getOrbitalByID(id,{refresh:false});
  if(!item||Number(item.typeID)!==81080||!r)return null;
  const planet=orbitals._testing.findPlanetByID(Number(r.planetID));
  if(!planet||Number(item.locationID)!==Number(r.solarSystemID)||Number(item.flagID)!==0||Number(planet.solarSystemID)!==Number(r.solarSystemID))return null;
  return {itemID:Number(id),planetID:Number(r.planetID),planetTypeID:Number(planet.typeID),planetName:planet.itemName,solarSystemID:Number(r.solarSystemID),ownerCorpID:Number(item.ownerID),installerID:Number(item.spaceState?.skyhookPiInstallerID)||0,active:[0,1].includes(Number(r.state))&&!r.destroyedAtMs,destroyed:!!r.destroyedAtMs};
 }
 function manage(s,a){const who=identity(s);if(who.corpID!==a.ownerCorpID)return false;const corp=corps.getCorporationRecord(who.corpID);const role=roles.getCorporationSessionRoleState(who.corpID,who.characterID);return a.installerID===who.characterID||Number(corp.ceoID)===who.characterID||(BigInt(role.corprole||0)&1n)!==0n;}
 function collect(s,a,p,q,flagID){
  const who=identity(s),shipID=Number(s?._space?.shipID),ship=items.findItemById(shipID),systemID=Number(s?._space?.systemID);
  if(who.corpID!==a.ownerCorpID)throw Error('ACCESS_DENIED');
  if(!ship||Number(ship.ownerID)!==who.characterID||Number(ship.locationID)!==systemID||systemID!==a.solarSystemID)throw Error('SHIP_NOT_IN_SYSTEM');
  const entity=space.getEntity(s,shipID),target=space.getEntity(s,a.itemID);
  if(!entity||!target)throw Error('SKYHOOK_OUT_OF_RANGE');
  const distance=Math.hypot(...['x','y','z'].map(k=>Number(entity.position[k])-Number(target.position[k])))-Number(entity.radius||0)-Number(target.radius||0);
  if(!Number.isFinite(distance)||distance>maxDistance)throw Error('SKYHOOK_OUT_OF_RANGE');
  const metadata=items.getItemMetadata(p.typeID),volume=Number(metadata.volume);
  if(!(volume>0))throw Error('INVALID_PRODUCT_VOLUME');
  const snapshot=fitting.getShipFittingSnapshot(who.characterID,shipID,{shipItem:ship,reason:'skyhook-pi.collect'});
  const resources=snapshot?.resourceState||{};
  if(flagID!==items.ITEM_FLAGS.CARGO_HOLD && (!holds.isSpecialShipHoldFlag(flagID)||!holds.isSpecialShipHoldItemAllowed(metadata,flagID)))throw Error('INVALID_HOLD');
  const capacity=flagID===items.ITEM_FLAGS.CARGO_HOLD?Number(resources.cargoCapacity||0):holds.getSpecialShipHoldCapacity(resources,ship.typeID,flagID,live.getShipBaseAttributeValue);
  let used=0;
  for(const i of items.listContainerItems(who.characterID,shipID,flagID)){
   const v=Number(i.volume??items.getItemMetadata(i.typeID).volume),n=Number(i.stacksize??i.quantity??1);
   if(!Number.isFinite(v)||v<0||!Number.isFinite(n)||n<0)throw Error('CARGO_VOLUME_UNKNOWN');used+=v*Math.max(1,n);
  }
  const quantity=Math.min(q,Math.floor(Math.max(0,capacity-used)/volume));if(!Number.isSafeInteger(quantity)||quantity<=0)throw Error('CARGO_FULL');
  return {ownerID:who.characterID,shipID,flagID,quantity};
 }
 return {identity,anchor,manage,collect,collectRangeMeters:maxDistance,
  list(s){const who=identity(s);return Object.values(orbitals.readState().orbitalsByID||{}).filter(r=>Number(r.typeID)===81080).map(r=>anchor(Number(r.itemID))).filter(a=>a&&a.ownerCorpID===who.corpID);},
  receipt:key=>items.getIdempotentGrantReceipt(key,{requireDurable:true}),
  grant:p=>items.grantItemToOwnerLocationIdempotent(p.ownerID,p.shipID,p.flagID,p.typeID,p.quantity,{receiptKey:p.receiptKey}),
  notify(s,r){for(const change of r?.data?.changes||[])characters.syncInventoryItemForSession(s,change.item||items.findItemById(change.itemID),change.previousState||change.previousData||{});}
 };
}
module.exports={createAuthority};
