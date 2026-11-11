"use strict";
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {isMainThread}=require('node:worker_threads');
const {assertRoot}=require('./lib/compatibility'),{transform,SYMBOL}=require('./lib/orbitals');
const {openStore}=require('./lib/store'),{createLifecycle}=require('./lib/lifecycle');
const {createFaultPolicy}=require('./lib/fault');
const {createService}=require('./lib/service'),{createAuthority}=require('./lib/authority'),{buildCatalogue}=require('./lib/catalogue');
const {config,advance}=require('./lib/production'),{createDelivery,installPacketHook}=require('./lib/delivery'),{installRpc}=require('./lib/rpc');
const {registerExtensionHook,registerLoadHook}=require('./lib/moduleHookRegistry');
const {createModuleTargetCache}=require('./lib/moduleTargetCache');
const MARK=Symbol.for(SYMBOL),canonical=p=>fs.realpathSync(p).replace(/\\/g,'/').replace(process.platform==='win32'?/[A-Z]/g:/(?!)/g,c=>c.toLowerCase());
// fork() inherits preload hooks, and its main thread is not the world process.
// OWNER_ROLE is inherited too and is assigned by worker entrypoints only AFTER
// preload. Resolve the entrypoint as a Node module (npm start uses `node .`)
// before touching settings, SQLite or hooks.
function isWorldProcess(root){
 if(!isMainThread||!process.argv[1])return false;
 try{return canonical(require.resolve(path.resolve(process.argv[1])))===canonical(path.join(root,'server/index.js'));}catch{return false;}
}
function install(root=path.resolve(__dirname,'../..')){
 if(!isWorldProcess(root)){
  if(isMainThread)console.log('[SkyhookPI] skipped non-world process pid='+process.pid+' entry='+JSON.stringify(process.argv[1]||null));
  return {active:false,reason:'not-world-entrypoint'};
 }
 if(globalThis[MARK])return globalThis[MARK];assertRoot(root);
 const relative={bootstrap:'server/bootstrap.js',planet:'server/src/services/planet/planetOrbitalState.js',items:'server/src/services/inventory/itemStore.js',rpc:'server/src/services/planet/planetMgrService.js',packet:'server/src/network/tcp/utils/marshal.js',chat:'server/src/services/chat/chatCommands.js',plain:'server/src/_secondary/chat/chatRuntime.js'};
 const targets=new Map(Object.entries(relative).map(([k,v])=>[canonical(path.join(root,v)),k]));
 const classifyTarget=createModuleTargetCache(targets,canonical);
 for(const file of Object.keys(require.cache))if(classifyTarget(file))throw Error('PRELOAD_REQUIRED');
 const settingsPath=path.join(root,'config/skyhook-pi.config.json');
 const settings=config(fs.existsSync(settingsPath)?JSON.parse(fs.readFileSync(settingsPath,'utf8')):{});
 const store=openStore(path.join(root,'_local/mods/skyhook-pi/state.sqlite')),life=createLifecycle(store);
 const compose=createDelivery(__dirname);let service,rpc,timer,closed=false,knownItemIDs=[];
 store.transaction(()=>{const rows=store.list();knownItemIDs=rows.filter(row=>row.status!=='destroyed').map(row=>row.itemID);for(const old of rows){
  if(JSON.stringify(old.config)!==JSON.stringify(settings)){
   const row=advance(old,Date.now());row.config=settings;row.lastCycleMs=Math.max(row.lastCycleMs,Date.now());store.save(row);
  }
 }});const faults=createFaultPolicy(knownItemIDs);
 function ensureService(){
  if(closed)throw Error('MOD_CLOSED');
  if(!service){const authority=createAuthority(root),staticApi=require(path.join(root,'server/src/services/planet/planetStaticData'));
   service=createService({store,authority,catalogue:id=>buildCatalogue(id,staticApi),settings});
   timer=setInterval(()=>{try{reconcile();}catch(e){console.error('[SkyhookPI] reconcile: '+e.message);}},30000);timer.unref();
  }return service;
 }
 function getService(){if(faults.message())throw Error('PI_STATE_UNAVAILABLE: '+faults.message());return ensureService();}
 function reconcile(){
  const previous=faults.message();
  const result=faults.reconcile(()=>{ensureService().reconcile();return {itemIDs:store.list().filter(row=>row.status!=='destroyed').map(row=>row.itemID)};});
  if(previous)console.log('[SkyhookPI] reconciliation recovered PI state after: '+previous);
  return result;
 }
 const restorers=[],seen=new WeakSet();
 function hookedExtension(next,mod,filename){
  const kind=classifyTarget(filename);if(!['planet','items','bootstrap'].includes(kind))return next();
  const originalCompile=mod._compile;
  mod._compile=function(source,file){return originalCompile.call(this,transform(kind,source),file);};
  try{return next();}finally{mod._compile=originalCompile;}
 }
 function open(s){return rpc?rpc.open(s):'Skyhook PI service is loading.';}
 function hookedLoad(exp,request,parent,isMain){
  if(!exp||!['function','object'].includes(typeof exp)||Module.isBuiltin(request))return exp;
  let kind;try{kind=classifyTarget(Module._resolveFilename(request,parent,isMain));}catch{return exp;}
  if(!kind||seen.has(exp))return exp;
  if(kind==='rpc'){rpc=installRpc(exp,getService);restorers.push(()=>rpc.restore());}
  if(kind==='packet'){const orig=exp.encodePacket;installPacketHook(exp,compose);const own=exp.encodePacket;restorers.push(()=>{if(exp.encodePacket===own)exp.encodePacket=orig;});}
  if(kind==='chat'||kind==='plain')for(const [name,index]of (kind==='chat'?[['executeChatCommand',1]]:[['broadcastLocalMessage',1],['sendChannelMessage',2]])){
   const original=exp[name];if(typeof original!=='function')continue;
   const wrapped=function(...args){if(typeof args[index]!=='string'||!/^[!/]skyhookpi\s*$/i.test(args[index].trim()))return original.apply(this,args);const reply=open(args[0]);if(kind==='plain')throw Error(reply);const [session,,hub,options={}]=args;if(hub&&options.emitChatFeedback!==false)hub.sendSystemMessage(session,reply,options.feedbackChannel||options.channel||null);return {handled:true,message:reply};};exp[name]=wrapped;restorers.push(()=>{if(exp[name]===wrapped)exp[name]=original;});
  }
  seen.add(exp);return exp;
 }
 function afterCommit(fn,...args){try{fn(...args);}catch(e){faults.record(e);console.error('[SkyhookPI] committed host change; PI paused by storage fault: '+e.message);}}
 const unregisterExtension=registerExtensionHook('.js',hookedExtension),unregisterLoad=registerLoadHook(hookedLoad);
 const state={active:true,
  beforeItemChanges(...args){if(!faults.beforeItemChanges(...args))return;return life.beforeItemChanges(...args);},
  afterItemChanges(...args){if(faults.message()&&!faults.affectedItemChanges(args[0],args[0],args[1]))return;afterCommit(life.afterItemChanges,...args);},
  beforeOrbitals(...args){faults.beforeOrbitals(...args);return life.beforeOrbitals(...args);},
  afterOrbitals(...args){afterCommit(life.afterOrbitals,...args);},
  startup(){reconcile();console.log('[SkyhookPI] startup reconciliation complete');},
  getService,close(){if(closed)return;closed=true;clearInterval(timer);unregisterLoad();unregisterExtension();for(const undo of restorers.reverse())undo();store.close();state.active=false;delete globalThis[MARK];}};
 globalThis[MARK]=state;
 process.once('exit',()=>{if(!closed)store.close();});
 console.log('[SkyhookPI] 0.1.17 loaded; !skyhookpi');return state;
}
module.exports={install};
if(process.env.EVEJS_SKYHOOK_PI_NO_AUTOINSTALL!=='1')install();
