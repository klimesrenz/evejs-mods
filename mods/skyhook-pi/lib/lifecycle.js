"use strict";
const {advance}=require('./production');
function createLifecycle(store,clock=Date.now){
 let busy=false;
 function rows(){return store.list().filter(r=>r.status!=='destroyed');}
 function hasCargo(row){return row.products.some(p=>p.quantity>0)||store.pending(row.itemID).length>0;}
 function guard(row){if(hasCargo(advance(row,clock())))throw Error('SKYHOOK_PI_EMPTY_STORE_BEFORE_REMOVAL');}
 function pause(row){const next=advance(row,clock());next.status='paused';next.lastCycleMs=Math.max(next.lastCycleMs,clock());return next;}
 return {
  beforeItemChanges(before,after,touched){
   if(busy)return;
   for(const id of touched){
    if(!Number.isSafeInteger(Number(id))||Number(id)<=0)continue;
    const row=store.get(Number(id));if(!row||row.status==='destroyed'||!before[String(id)])continue;
    const next=after[String(id)];
    if(!next||Number(next.locationID)!==row.solarSystemID||Number(next.flagID)!==0||Number(next.typeID)!==81080)guard(row);
    if(next&&Number(next.ownerID)!==row.ownerCorpID&&store.pending(row.itemID).length)throw Error('SKYHOOK_PI_RECOVERY_PENDING');
   }
  },
  afterItemChanges(data,touched){
   if(busy)return;busy=true;
   try{store.transaction(()=>{for(const id of touched){
    if(!Number.isSafeInteger(Number(id))||Number(id)<=0)continue;
    const old=store.get(Number(id));if(!old||old.status==='destroyed')continue;
    const next=data[String(id)];
    if(!next||Number(next.locationID)!==old.solarSystemID||Number(next.flagID)!==0||Number(next.typeID)!==81080){
     const row=pause(old);row.status='destroyed';row.products.forEach(p=>p.quantity=0);store.save(row);
    }else if(Number(next.ownerID)!==old.ownerCorpID){const row=pause(old);row.ownerCorpID=Number(next.ownerID);row.installerID=0;store.save(row);}
   }});}finally{busy=false;}
  },
  beforeOrbitals(state){
   if(busy)return;
   for(const row of rows()){
    const next=state.orbitalsByID?.[String(row.itemID)];
    // Missing stale rows are reconciled at startup; they cannot block other orbitals.
    if(!next)continue;
    if(!next.destroyedAtMs&&[-3,-2].includes(Number(next.state)))guard(row);
    if(Number(next.corporationID||next.ownerID)!==row.ownerCorpID&&store.pending(row.itemID).length)throw Error('SKYHOOK_PI_RECOVERY_PENDING');
   }
  },
  afterOrbitals(state){
   if(busy)return;busy=true;
   try{store.transaction(()=>{for(const original of rows()){
    const next=state.orbitalsByID?.[String(original.itemID)];if(!next)continue;
    const owner=Number(next.corporationID||next.ownerID);
    if([0,1].includes(Number(next.state))&&!next.destroyedAtMs&&owner===original.ownerCorpID)continue;
    const row=pause(original);
    if(next.destroyedAtMs){row.status='destroyed';row.products.forEach(p=>p.quantity=0);}
    else if(owner!==original.ownerCorpID){row.ownerCorpID=owner;row.installerID=0;}
    store.save(row);
   }});}finally{busy=false;}
  }
 };
}
module.exports={createLifecycle};
