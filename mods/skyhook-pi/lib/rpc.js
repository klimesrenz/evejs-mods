"use strict";
function installRpc(Service,getService){
 const ready=new WeakMap(),limits=new WeakMap();
 function character(s){return Number(s?.characterID||s?.charid)||0;}
 function run(s,fn){
  try{if(!character(s))throw Error('CHARACTER_REQUIRED');const now=Date.now(),last=limits.get(s)||0;if(now-last<200)throw Error('RATE_LIMIT');limits.set(s,now);return JSON.stringify(fn());}
  catch(e){console.error('[SkyhookPI] RPC: '+e.message);return JSON.stringify({ok:false,code:String(e.message).slice(0,300)});}
 }
 const previous=new Map();
 function add(name,fn){if(Service.prototype[name])throw Error('RPC_ALREADY_REGISTERED');previous.set(name,fn);Service.prototype[name]=fn;}
 add('Handle_SkyhookPiReady',function(args,s){if(character(s))ready.set(s,character(s));return JSON.stringify({ok:!!character(s),version:'0.1.10'});});
 add('Handle_SkyhookPiList',function(args,s){return run(s,()=>getService().list(s));});
 add('Handle_SkyhookPiAction',function(args,s){return run(s,()=>{
  let raw=Array.isArray(args)?args[0]:null;
  if(raw&&['wstring','token','rawstr'].includes(raw.type))raw=raw.value;
  if(Buffer.isBuffer(raw)){if(raw.length>4096)throw Error('INVALID_REQUEST');raw=raw.toString('utf8');}
  if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>4096)throw Error('INVALID_REQUEST');
  const req=JSON.parse(raw);if(!req||!['start','pause','collect'].includes(req.action))throw Error('INVALID_ACTION');
  for(const key of Object.keys(req))if(!['action','itemID','typeID','quantity','flagID','requestID'].includes(key))throw Error('INVALID_FIELD');
  const svc=getService();return req.action==='collect'?svc.collect(s,req):svc[req.action](s,req.itemID,req.requestID);
 });});
 return {open(s){if(!character(s)||ready.get(s)!==character(s))return 'Skyhook PI UI not ready; restart client.';s.sendNotification('OnSkyhookPiOpen','clientID',[]);return 'Skyhook PI opened.';},restore(){for(const [name,fn]of previous)if(Service.prototype[name]===fn)delete Service.prototype[name];}};
}
module.exports={installRpc};
