'use strict';
const crypto=require('node:crypto'),{isDeepStrictEqual}=require('node:util');
const {quoteRecipe,positive,MAX_QUANTITY}=require('./catalogue');
function createService({store,authority,inventory,catalogue,clock=Date.now}) {
  const recipes=new Map(catalogue.map(r=>[r.schematicID,r]));
  function recipe(id){positive(id);const r=recipes.get(id);if(!r)throw Error('RECIPE_NOT_FOUND');return r;}
  function requestID(id){if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{8,80}$/.test(id))throw Error('INVALID_REQUEST_ID');return id;}
  function readRequest(ownerID,id,payload){const r=store.getRequest(ownerID,requestID(id));if(r&&!isDeepStrictEqual(r.payload,payload))throw Error('REQUEST_MISMATCH');return r;}
  function save(j){store.transaction(()=>store.saveJob(j));return j;}
  function owned(s,id){const j=store.getJob(id);if(!j||j.ownerID!==authority.identity(s))throw Error('JOB_NOT_FOUND');return j;}
  function view(s,j){let canCollect=false;try{authority.dock(s,j.locationID);canCollect=j.status==='running'&&clock()>=j.finishAtMs;}catch{}
    return {id:j.id,locationID:j.locationID,locationKind:j.locationKind,recipe:j.recipe,batches:j.batches,outputs:j.outputs,status:j.status,finishAtMs:j.finishAtMs,
      ready:j.status==='running'&&clock()>=j.finishAtMs,canCollect,locationExists:authority.exists(j.locationID,j.locationKind),code:j.code||null};
  }
  function response(s,j){return {ok:true,job:view(s,j),serverNow:clock()};}
  function notify(s,result){try{inventory.notify(s,result);}catch(e){console.error('[PIProcessing] inventory notification: '+e.message);}}
  function settle(j){
    if(!['starting','delivering'].includes(j.status))return j;
    const consuming=j.status==='starting',r=inventory.receipt(consuming?j.consumeKey:j.grantKey);
    if(r.state==='uncertain')return j;
    if(r.state==='completed'){
      const expected=consuming?isDeepStrictEqual(r.receipt?.fingerprint,j.consumeIntent.fingerprint):
        r.receipt?.ownerID===j.ownerID&&r.receipt?.locationID===j.locationID&&r.receipt?.flagID===j.flagID&&
        isDeepStrictEqual(r.receipt?.manifest,j.outputs.slice().sort((a,b)=>a.typeID-b.typeID));
      if(!expected){j.code='RECEIPT_MISMATCH';return save(j);}
      j.status=consuming?'running':'delivered';j.code=null;
    } else {j.status=consuming?'rejected':'running';j.code=consuming?'START_NOT_COMMITTED':null;}
    return save(j);
  }
  return {
    catalogue(s){authority.identity(s);return {ok:true,recipes:catalogue,serverNow:clock()};},
    quote(s,req){const r=recipe(req.schematicID),c=authority.dock(s),{totals}=authority.available(c);positive(req.batches);
      const maxBatches=Math.max(0,Math.min(...r.inputs.map(e=>Math.floor((totals.get(e.typeID)||0)/e.quantity)),...[...r.inputs,...r.outputs].map(e=>Math.floor(MAX_QUANTITY/e.quantity))));
      if(req.batches>MAX_QUANTITY)throw Error('INVALID_QUANTITY');
      const inputs=r.inputs.map(e=>({...e,quantity:positive(e.quantity*req.batches),available:totals.get(e.typeID)||0}));
      const outputs=r.outputs.map(e=>({...e,quantity:positive(e.quantity*req.batches)}));
      return {ok:true,locationID:c.locationID,inputs,outputs,maxBatches,batches:req.batches,durationMs:r.cycleMs,enough:req.batches<=maxBatches,serverNow:clock()};
    },
    start(s,req){
      const ownerID=authority.identity(s),payload={action:'start',schematicID:positive(req.schematicID),batches:positive(req.batches)};
      const old=readRequest(ownerID,req.requestID,payload);if(old)return response(s,settle(owned(s,old.jobID)));
      const c=authority.dock(s),r=recipe(req.schematicID);
      if(r.mode==='p1-chain'&&req.mode!==r.mode)throw Error('RECIPE_CHANGED');
      const q=quoteRecipe(r,req.batches,authority.available(c).totals);
      const id=crypto.randomUUID(),startedAtMs=clock(),requests=authority.select(c,q.inputs);
      if(requests.length>10000)throw Error('TOO_MANY_STACKS');
      const j={...c,id,recipe:structuredClone(r),batches:req.batches,inputs:q.inputs,outputs:q.outputs,status:'starting',startedAtMs,finishAtMs:positive(startedAtMs+q.durationMs),consumeKey:'pi-processing:'+id+':consume',grantKey:'pi-processing:'+id+':grant'};
      j.consumeIntent={key:j.consumeKey,startedAtMs,requests,fingerprint:{ownerID,locationID:c.locationID,flagID:c.flagID,requests,recipe:j.recipe,batches:j.batches}};
      store.transaction(()=>{store.saveJob(j);store.saveRequest({ownerID,id:req.requestID,payload,jobID:id});});
      try {const result=inventory.consume(j.consumeIntent);notify(s,result);}catch(e){console.error('[PIProcessing] consume recovery: '+e.message);}
      return response(s,settle(j));
    },
    collect(s,req){
      const ownerID=authority.identity(s),payload={action:'collect',jobID:req.jobID};
      const prior=readRequest(ownerID,req.requestID,payload);let j=settle(owned(s,req.jobID));
      if(j.status==='delivered'||j.status==='delivering')return response(s,j);
      if(j.status!=='running'||clock()<j.finishAtMs)throw Error('JOB_NOT_READY');
      authority.dock(s,j.locationID);
      j.status='delivering';j.grantIntent={key:j.grantKey,ownerID,locationID:j.locationID,flagID:j.flagID,outputs:j.outputs};
      store.transaction(()=>{store.saveJob(j);if(!prior)store.saveRequest({ownerID,id:req.requestID,payload,jobID:j.id});});
      try{const result=inventory.grant(j.grantIntent);notify(s,result);}catch(e){console.error('[PIProcessing] grant recovery: '+e.message);}
      return response(s,settle(j));
    },
    list(s,req={}){const ownerID=authority.identity(s),limit=req.limit??50,cursor=req.cursor??'';
      if(!Number.isInteger(limit)||limit<1||limit>50||typeof cursor!=='string'||cursor.length>80)throw Error('INVALID_PAGE');
      const jobs=[];let scanCursor=cursor,more=false;
      do {
        const remaining=limit-jobs.length,rows=store.listJobs(ownerID,scanCursor,remaining);
        more=rows.length===remaining;
        if(rows.length)scanCursor=rows.at(-1).id;
        for(const row of rows){const j=settle(row);if(j.status!=='delivered')jobs.push(view(s,j));}
      } while(more&&jobs.length<limit);
      return {ok:true,jobs,nextCursor:more?scanCursor:null,serverNow:clock()};
    },
    reconcile(){for(const j of store.pending())settle(j);}
  };
}
module.exports={createService};
