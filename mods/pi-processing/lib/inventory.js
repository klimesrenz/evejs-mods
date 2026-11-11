'use strict';
const path=require('node:path');
function classifyReceipt(r){
  if(!r?.success)return {state:'uncertain'};
  if(!r.found)return {state:'absent'};
  return r.durable?{state:'completed',receipt:r.data}:{state:'uncertain'};
}
function createInventory(root) {
  const items=require(path.join(root,'server/src/services/inventory/itemStore'));
  const chars=require(path.join(root,'server/src/services/character/characterState'));
  if(typeof items.exchangeInventoryItemStacksIdempotent!=='function')throw Error('CORE_INVENTORY_EXCHANGE_UNAVAILABLE');
  function normalize(r){return {ok:!!r?.success,durable:!!r?.durable,duplicate:!!r?.duplicate,changes:r?.data?.changes||[],code:r?.errorMsg};}
  return {
    receipt(key){try{return classifyReceipt(items.getIdempotentGrantReceipt(key,{requireDurable:true}));}catch{return {state:'uncertain'};}},
    consume(p){return normalize(items.exchangeInventoryItemStacksIdempotent(p.requests,[],{receiptKey:p.key,fingerprint:p.fingerprint,completedAtMs:p.startedAtMs}));},
    grant(p){return normalize(items.grantItemsToOwnerLocationIdempotent(p.ownerID,p.locationID,p.flagID,p.outputs.map(o=>({itemType:o.typeID,quantity:o.quantity})),{receiptKey:p.key}));},
    notify(s,r){for(const change of r?.changes||[]){const previous=change.previousState||change.previousData||{};
      const item=change.item || (change.previousData?{...change.previousData,locationID:0,quantity:0,stacksize:0}:null);
      chars.syncInventoryItemForSession(s,item,previous);
    }}
  };
}
module.exports={createInventory,classifyReceipt};
