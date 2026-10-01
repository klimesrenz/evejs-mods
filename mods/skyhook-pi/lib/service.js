"use strict";
const crypto=require('node:crypto');
const {advance,config,positive}=require('./production');
function createService({store,authority,catalogue,clock=Date.now,settings={}}) {
 const cfg=config(settings);let busy=false;
 function lane(fn){if(busy)throw Error('PI_BUSY');busy=true;try{return fn();}finally{busy=false;}}
 function recover(id){
  for(const p of store.pending(id)){
   const r=authority.receipt(p.receiptKey);if(!r?.success)throw Error('RECOVERY_PENDING');
   store.transaction(()=>{
    const row=store.get(p.itemID);if(!row)throw Error('RESERVATION_OWNER_MISSING');
    if(!r.found && row.status!=='destroyed'){const product=row.products.find(x=>x.typeID===p.typeID);if(!product)throw Error('RESERVATION_PRODUCT_MISSING');product.quantity+=p.quantity;store.save(row);}
    const result={ok:!!r.found,code:r.found?'COLLECTED':'GRANT_NOT_COMMITTED',quantity:r.found?p.quantity:0,requestID:p.requestID};
    store.remember(p.ownerID,p.requestID,p.payload,result);store.finish(p.receiptKey);
   });
  }
 }
 function syncRow(id){
  let row=store.get(id);if(!row)return null;
  const a=authority.anchor(id);
  if(!a || a.destroyed){row.status='destroyed';row.products.forEach(p=>p.quantity=0);}
  else if(a.planetID!==row.planetID || a.solarSystemID!==row.solarSystemID){row.status='destroyed';row.products.forEach(p=>p.quantity=0);row.lastCycleMs=clock();}
  else {
   if(!a.active && row.status==='running'){row.status='paused';row.lastCycleMs=clock();}
   row=advance(row,clock());
   if(a.ownerCorpID!==row.ownerCorpID){row.ownerCorpID=a.ownerCorpID;row.installerID=0;row.status='paused';row.lastCycleMs=clock();}
  }
  if(JSON.stringify(row)!==JSON.stringify(store.get(id)))store.transaction(()=>store.save(row));
  return row;
 }
 function check(session,id,manage=false){
  positive(id,'ITEM_ID');const who=authority.identity(session),a=authority.anchor(id);
  if(!a || a.destroyed)throw Error('SKYHOOK_UNAVAILABLE');
  if(who.corpID!==a.ownerCorpID)throw Error('ACCESS_DENIED');
  const row=store.get(id);
  if(manage && !authority.manage(session,{...a,installerID:row?(row.ownerCorpID===a.ownerCorpID?row.installerID:0):a.installerID}))throw Error('MANAGE_DENIED');
  return {who,a};
 }
 function key(who,requestID,payload){
  if(typeof requestID!=='string'||! /^[a-zA-Z0-9_-]{8,100}$/.test(requestID))throw Error('INVALID_REQUEST_ID');
  const previous=store.request(who.characterID,requestID);
  if(previous && previous.payload!==payload)throw Error('REQUEST_CONFLICT');
  return previous?.result;
 }
 function change(session,id,requestID,action){return lane(()=>{
  const {who,a}=check(session,id,true);recover(id);const payload=JSON.stringify({action,itemID:id});const prev=key(who,requestID,payload);if(prev)return prev;
  let row=syncRow(id);
  if(!row||row.status==='destroyed'){if(action!=='start')throw Error('NOT_CONFIGURED');row={itemID:id,planetID:a.planetID,solarSystemID:a.solarSystemID,ownerCorpID:a.ownerCorpID,installerID:a.installerID||who.characterID,status:'paused',lastCycleMs:clock(),config:cfg,products:catalogue(a.planetTypeID)};}
  if(row.status==='destroyed')throw Error('SKYHOOK_DESTROYED');
  if(action==='start'&&!a.active)throw Error('SKYHOOK_NOT_ACTIVE');
  row.config=cfg;row.status=action==='start'?'running':'paused';row.lastCycleMs=Math.max(clock(),row.lastCycleMs);
  const result={ok:true,code:row.status.toUpperCase(),requestID};
  store.transaction(()=>{store.save(row);store.remember(who.characterID,requestID,payload,result);});return result;
 });}
 function collect(session,request){return lane(()=>{
  const {itemID,typeID,quantity,flagID,requestID}=request;
  positive(typeID,'TYPE_ID');positive(quantity,'QUANTITY');positive(flagID,'FLAG');
  const {who,a}=check(session,itemID);recover(itemID);
  const payload=JSON.stringify({action:'collect',itemID,typeID,quantity,flagID});const prev=key(who,requestID,payload);if(prev)return prev;
  const row=syncRow(itemID);if(!row||row.status==='destroyed')throw Error('NOT_CONFIGURED');
  const product=row.products.find(p=>p.typeID===typeID);if(!product||product.quantity<=0)throw Error('EMPTY_STOCK');
  const destination=authority.collect(session,a,product,Math.min(quantity,product.quantity),flagID);
  positive(destination.quantity,'QUANTITY');
  if(destination.quantity>Math.min(quantity,product.quantity))throw Error('INVALID_RESERVATION');
  const p={...destination,itemID,typeID,requestID,payload,receiptKey:'skyhook-pi:'+crypto.randomUUID()};
  product.quantity-=p.quantity;
  store.transaction(()=>{store.save(row);store.reserve(p);store.remember(who.characterID,requestID,payload,{ok:false,code:'RECOVERY_PENDING',requestID});});
  const granted=authority.grant(p);recover(itemID);
  const result=store.request(who.characterID,requestID).result;
  if(result.ok){try{authority.notify(session,granted);}catch(e){console.error('[SkyhookPI] inventory notification: '+e.message);}}
  return result;
 });}
 function reconcile(){return lane(()=>{recover();for(const row of store.list())syncRow(row.itemID);});}
 function list(session){return lane(()=>{
  const who=authority.identity(session);recover();
  const rows=[];
  for(const a of authority.list(session)){
   if(a.ownerCorpID!==who.corpID||a.destroyed)continue;
   const r=syncRow(a.itemID);
   rows.push({...a,canManage:authority.manage(session,{...a,installerID:r?r.installerID:a.installerID}),status:r?.status||'not_configured',config:r?.config||cfg,products:r?.products||catalogue(a.planetTypeID)});
  }
  return {ok:true,characterID:who.characterID,collectRangeMeters:authority.collectRangeMeters,rows};
 });}
 return {start:(s,id,r)=>change(s,id,r,'start'),pause:(s,id,r)=>change(s,id,r,'pause'),collect,reconcile,list};
}
module.exports={createService};
