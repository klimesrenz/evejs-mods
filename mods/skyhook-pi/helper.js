"use strict";
const fs=require('node:fs'),path=require('node:path');
const {assertRoot}=require('./lib/compatibility');
const {openStore}=require('./lib/store'),{advance}=require('./lib/production');
const {createDelivery}=require('./lib/delivery');
const ACTIONS=new Set(['install','verify','prepare_profile','prepare_disable','prepare_remove','recover']);
function execute(request){
 if(!ACTIONS.has(request.action))throw Error('Unsupported helper action');
 const removing=['prepare_disable','prepare_remove'].includes(request.action);
 const root=path.resolve(request.runtime?.evejsRoot||request.mod?.root||'');
 if(!request.runtime?.evejsRoot&&!request.mod?.root)throw Error('Runtime root required');
 if(removing){
  const filename=path.join(root,'_local/mods/skyhook-pi/state.sqlite');
  if(fs.existsSync(filename)){
   const store=openStore(filename);
   try{store.transaction(()=>{for(const source of store.list()){if(source.status==='destroyed')continue;const row=advance(source,Date.now());row.status='paused';row.lastCycleMs=Math.max(row.lastCycleMs,Date.now());store.save(row);}store.setMeta('modEnabled',false);});}finally{store.close();}
  }
 } else {
  if((request.runtime?.backend||'native')!=='native')throw Error('Native only');
  assertRoot(root);createDelivery(path.resolve(request.mod.path));
 }
 return {protocol:request.protocol,requestId:request.requestId,success:true,state:'ready',message:removing?'PI production paused; stored goods retained. Restart server and all clients.':'Skyhook PI verified. Restart server and all clients.',restartRequired:[],contributions:[],environment:{},arguments:[]};
}
if(require.main===module){
 function arg(name){const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw Error('Missing '+name);return process.argv[i+1];}
 try{const req=JSON.parse(fs.readFileSync(arg('--request'),'utf8'));let result;try{result=execute(req);}catch(e){result={protocol:req.protocol,requestId:req.requestId,success:false,state:'failed',message:e.message,restartRequired:[],contributions:[],environment:{},arguments:[]};}fs.writeFileSync(arg('--result'),JSON.stringify(result));if(!result.success)process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}
}
module.exports={execute};
