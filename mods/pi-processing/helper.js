'use strict';
const fs=require('node:fs'),path=require('node:path');
const {assertRoot}=require('./lib/compatibility'),{createDelivery}=require('./lib/delivery');
function execute(request){
  if(!['install','verify','prepare_profile','prepare_disable','prepare_remove','recover'].includes(request.action))throw Error('Unsupported helper action');
  const removing=['prepare_disable','prepare_remove'].includes(request.action);
  if(!request.runtime?.evejsRoot&&!request.mod?.root)throw Error('Runtime root required');
  if(!removing){if((request.runtime?.backend||'native')!=='native')throw Error('Native only');assertRoot(path.resolve(request.runtime?.evejsRoot||request.mod.root));createDelivery(path.resolve(request.mod.path));}
  return {protocol:request.protocol,requestId:request.requestId,success:true,state:'ready',message:removing?'Jobs retained; timers continue. Restart server and clients.':'PI Processing verified. Restart server and clients.',restartRequired:[],contributions:[],environment:{},arguments:[]};
}
if(require.main===module){
  const arg=name=>{const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw Error('Missing '+name);return process.argv[i+1];};
  try{const req=JSON.parse(fs.readFileSync(arg('--request'),'utf8'));let result;try{result=execute(req);}catch(e){result={protocol:req.protocol,requestId:req.requestId,success:false,state:'failed',message:e.message,restartRequired:[],contributions:[],environment:{},arguments:[]};}fs.writeFileSync(arg('--result'),JSON.stringify(result));if(!result.success)process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}
}
module.exports={execute};
