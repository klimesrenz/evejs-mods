"use strict";
const path=require('node:path');
function resolveInstallerID(state,record,ownerCorpID){
 const intent=state?.replacementsByPlanet?.[String(record?.planetID)];
 const intentOwnerID=Number(intent?.context?.ownerID||intent?.context?.corporationID);
 return Number(intent?.launchedItemID)===Number(record?.itemID)&&intentOwnerID>0&&intentOwnerID===Number(ownerCorpID)
  ?Number(intent?.context?.characterID)||0:0;
}
function planCollection(products,volumeForType,availableVolume){
 if(!Number.isFinite(availableVolume)||availableVolume<0)throw Error('CARGO_VOLUME_UNKNOWN');
 let remaining=availableVolume;const result=[];
 for(const product of products){
  const typeID=Number(product?.typeID),stock=Number(product?.quantity),volume=Number(volumeForType(typeID));
  if(!Number.isSafeInteger(typeID)||typeID<=0||!Number.isSafeInteger(stock)||stock<0)throw Error('INVALID_STOCK');
  if(!(volume>0))throw Error('INVALID_PRODUCT_VOLUME');
  const quantity=Math.min(stock,Math.floor(remaining/volume+1e-9));
  if(quantity>0){result.push({typeID,quantity});remaining=Math.max(0,remaining-quantity*volume);}
 }
 return result;
}
function createAuthority(root){
 const get=p=>require(path.join(root,'server/src',p));
 const items=get('services/inventory/itemStore'),orbitals=get('services/planet/planetOrbitalState');
 const characters=get('services/character/characterState'),corps=get('services/corporation/corporationState'),roles=get('services/corporation/corporationRuntimeState');
 const holds=get('services/inventory/specialShipHoldRegistry'),fitting=get('_secondary/fitting/fittingRuntime');
 const live=get('services/fitting/liveFittingState'),space=get('space/runtime'),world=get('space/worldData');
 const resolveSessionCharacterID=get('services/_shared/sessionIdentity').resolveSessionCharacterID;
 const maxDistance=get('services/ship/cargoContainerRuntime').MAX_CARGO_CONTAINER_TRANSFER_DISTANCE_METERS;
 function identity(s){
  const characterID=resolveSessionCharacterID(s),c=characters.peekCharacterRecord(characterID);
  const corpID=Number(c?.corporationID),corp=corps.getCorporationRecord(corpID);
  if(!c||c.deletedAt||c.isDeleted||!corp||corp.isNPC!==false)throw Error('PLAYER_CORPORATION_REQUIRED');
  return {characterID,corpID};
 }
 function anchor(id){
  const item=items.findItemById(id),r=orbitals.getOrbitalByID(id,{refresh:false});
  if(!item||Number(item.typeID)!==81080||!r)return null;
  const planet=world.getCelestialByID(Number(r.planetID));
  if(!planet||Number(item.locationID)!==Number(r.solarSystemID)||Number(item.flagID)!==0||Number(planet.solarSystemID)!==Number(r.solarSystemID))return null;
  const state=orbitals.readState();
  return {itemID:Number(id),planetID:Number(r.planetID),planetTypeID:Number(planet.typeID),planetName:planet.itemName,solarSystemID:Number(r.solarSystemID),ownerCorpID:Number(item.ownerID),installerID:resolveInstallerID(state,r,item.ownerID),active:orbitals.isCustomsInventoryOrbitalRecord(r),destroyed:orbitals.isOrbitalRecordDestroyed(r)};
 }
 function manage(s,a){const who=identity(s);if(who.corpID!==a.ownerCorpID)return false;const corp=corps.getCorporationRecord(who.corpID);const role=roles.getCorporationSessionRoleState(who.corpID,who.characterID);return a.installerID===who.characterID||Number(corp.ceoID)===who.characterID||(BigInt(role.corprole||0)&1n)!==0n;}
 function collect(s,a,products,flagID){
  const who=identity(s),shipID=Number(s?._space?.shipID),ship=items.findItemById(shipID),systemID=Number(s?._space?.systemID);
  if(who.corpID!==a.ownerCorpID)throw Error('ACCESS_DENIED');
  if(!ship||Number(ship.ownerID)!==who.characterID||Number(ship.locationID)!==systemID||systemID!==a.solarSystemID)throw Error('SHIP_NOT_IN_SYSTEM');
  const scene=space.getSceneForSession(s),entity=scene?.getEntityByID?.(shipID),target=scene?.getEntityByID?.(a.itemID);
  if(!scene||Number(scene.systemID)!==systemID||!entity||!target)throw Error('SKYHOOK_OUT_OF_RANGE');
  const distance=typeof scene.getCommandTimeEntitySurfaceDistance==='function'
   ?scene.getCommandTimeEntitySurfaceDistance(entity,target)
   :Math.hypot(...['x','y','z'].map(k=>Number(entity.position[k])-Number(target.position[k])))-Number(entity.radius||0)-Number(target.radius||0);
  if(!Number.isFinite(distance)||distance>maxDistance)throw Error('SKYHOOK_OUT_OF_RANGE');
  const snapshot=fitting.getShipFittingSnapshot(who.characterID,shipID,{shipItem:ship,reason:'skyhook-pi.collect'});
  const resources=snapshot?.resourceState||{};
  const stocked=products.filter(p=>p.quantity>0),metadataByType=new Map();
  if(!stocked.length)throw Error('EMPTY_STOCK');
  for(const product of stocked){const metadata=items.getItemMetadata(product.typeID);metadataByType.set(product.typeID,metadata);
   if(flagID!==items.ITEM_FLAGS.CARGO_HOLD && (!holds.isSpecialShipHoldFlag(flagID)||!holds.isSpecialShipHoldItemAllowed(metadata,flagID)))throw Error('INVALID_HOLD');}
  const capacity=flagID===items.ITEM_FLAGS.CARGO_HOLD?Number(resources.cargoCapacity||0):holds.getSpecialShipHoldCapacity(resources,ship.typeID,flagID,live.getShipBaseAttributeValue);
  let used=0;
  for(const i of items.listContainerItems(who.characterID,shipID,flagID)){
   const v=Number(i.volume??items.getItemMetadata(i.typeID).volume),n=Number(i.stacksize??i.quantity??1);
   if(!Number.isFinite(v)||v<0||!Number.isFinite(n)||n<0)throw Error('CARGO_VOLUME_UNKNOWN');used+=v*Math.max(1,n);
  }
  const planned=planCollection(stocked,typeID=>metadataByType.get(typeID)?.volume,Math.max(0,capacity-used));
  if(!planned.length)throw Error('CARGO_FULL');
  return {ownerID:who.characterID,shipID,flagID,products:planned,quantity:planned.reduce((sum,p)=>sum+p.quantity,0)};
 }
 return {identity,anchor,manage,collect,collectRangeMeters:maxDistance,
  list(s){const who=identity(s);return Object.values(orbitals.readState().orbitalsByID||{}).filter(r=>Number(r.typeID)===81080).map(r=>anchor(Number(r.itemID))).filter(a=>a&&a.ownerCorpID===who.corpID);},
  receipt:key=>items.getIdempotentGrantReceipt(key,{requireDurable:true}),
  grant:p=>items.grantItemsToOwnerLocationIdempotent(p.ownerID,p.shipID,p.flagID,p.products.map(product=>({itemType:product.typeID,quantity:product.quantity})),{receiptKey:p.receiptKey}),
  notify(s,r){for(const change of r?.data?.changes||[])characters.syncInventoryItemForSession(s,change.item||items.findItemById(change.itemID),change.previousState||change.previousData||{});}
 };
}
module.exports={createAuthority,resolveInstallerID,planCollection};
