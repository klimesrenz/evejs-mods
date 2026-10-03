'use strict';
const path=require('node:path');
function transformItems(input) {
  let source=input.replace(/\r\n/g,'\n');
  if(source.includes('/* pi-processing:items */'))throw Error('ALREADY_TRANSFORMED');
  const start=source.indexOf('function consumeInventoryItemStacksAtomic('),end=source.indexOf('\n// Compensation boundary',start);
  if(start<0||end<0)throw Error('SOURCE_SEAM_MISMATCH');
  let body=source.slice(start,end);
  if(!body.includes('options.__evejsIdempotentInventoryReceipt')) {
    const seam='  if (!mutationPlan.commit({ indexDelta: indexDeltaFromChanges(changes) })) {';
    if(body.split(seam).length!==2||!body.includes('options = {}'))throw Error('UNSUPPORTED_ATOMIC_CONSUME');
    body=body.replace(seam,`  const piReceipt = attachIdempotentInventoryReceipt(items,
    options.__evejsIdempotentInventoryReceipt ? {
      ...cloneValue(options.__evejsIdempotentInventoryReceipt),
      resultData: { consumedQuantity, changes: cloneValue(changes) },
    } : null);
  if (!mutationPlan.commit({ indexDelta: indexDeltaFromChanges(changes),
    knownChangedPaths: piReceipt ? [piReceipt.path] : [],
  })) {`);
  }
  source=source.slice(0,start)+body+source.slice(end);
  return source+`\n/* pi-processing:items */
module.exports.piProcessingConsume = function(requests, options) {
  return executeIdempotentInventoryMutation(options, 'pi-processing-consume',
    receipt => consumeInventoryItemStacksAtomic(requests, {__evejsIdempotentInventoryReceipt:receipt}));
};\n`;
}
function createInventory(root) {
  const items=require(path.join(root,'server/src/services/inventory/itemStore'));
  const chars=require(path.join(root,'server/src/services/character/characterState'));
  if(typeof items.piProcessingConsume!=='function')throw Error('PRELOAD_REQUIRED');
  function normalize(r){return {ok:!!r?.success,durable:!!r?.durable,duplicate:!!r?.duplicate,changes:r?.data?.changes||[],code:r?.errorMsg};}
  return {
    receipt(key){try{const r=items.getIdempotentGrantReceipt(key,{requireDurable:true});return !r.success||!r.durable?{state:'uncertain'}:r.found?{state:'completed',receipt:r.data}:{state:'absent'};}catch{return {state:'uncertain'};}},
    consume(p){return normalize(items.piProcessingConsume(p.requests,{receiptKey:p.key,fingerprint:p.fingerprint,completedAtMs:p.startedAtMs}));},
    grant(p){return normalize(items.grantItemsToOwnerLocationIdempotent(p.ownerID,p.locationID,p.flagID,p.outputs.map(o=>({itemType:o.typeID,quantity:o.quantity})),{receiptKey:p.key}));},
    notify(s,r){for(const change of r?.changes||[]){const previous=change.previousState||change.previousData||{};
      const item=change.item || (change.previousData?{...change.previousData,locationID:0,quantity:0,stacksize:0}:null);
      chars.syncInventoryItemForSession(s,item,previous);
    }}
  };
}
module.exports={transformItems,createInventory};
