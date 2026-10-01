"use strict";
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {isMainThread}=require('node:worker_threads');
const {assertRoot}=require('./lib/compatibility'),{transform,SYMBOL}=require('./lib/orbitals');
const {openStore}=require('./lib/store'),{createLifecycle}=require('./lib/lifecycle');
const {createService}=require('./lib/service'),{createAuthority}=require('./lib/authority'),{buildCatalogue}=require('./lib/catalogue');
const {config,advance}=require('./lib/production'),{createDelivery,installPacketHook}=require('./lib/delivery'),{installRpc}=require('./lib/rpc');
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
 const relative={bootstrap:'server/bootstrap.js',planet:'server/src/services/planet/planetOrbitalState.js',items:'server/src/services/inventory/itemStore.js',launch:'server/src/services/ship/orbitalLaunchRuntime.js',rpc:'server/src/services/planet/planetMgrService.js',packet:'server/src/network/tcp/utils/marshal.js',chat:'server/src/services/chat/chatCommands.js',plain:'server/src/_secondary/chat/chatRuntime.js'};
 const targets=new Map(Object.entries(relative).map(([k,v])=>[canonical(path.join(root,v)),k]));
 for(const file of Object.keys(require.cache))if(targets.has(canonical(file)))throw Error('PRELOAD_REQUIRED');
 const settingsPath=path.join(root,'config/skyhook-pi.config.json');
 const settings=config(fs.existsSync(settingsPath)?JSON.parse(fs.readFileSync(settingsPath,'utf8')):{});
 const store=openStore(path.join(root,'_local/mods/skyhook-pi/state.sqlite')),life=createLifecycle(store);
 const compose=createDelivery(__dirname);let service,rpc,timer,closed=false,fault=null;
 store.transaction(()=>{for(const old of store.list()){
  if(JSON.stringify(old.config)!==JSON.stringify(settings)){
   const row=advance(old,Date.now());row.config=settings;row.lastCycleMs=Math.max(row.lastCycleMs,Date.now());store.save(row);
  }
 }});
 function getService(){
  if(closed)throw Error('MOD_CLOSED');if(fault)throw Error('PI_STATE_UNAVAILABLE: '+fault);
  if(!service){const authority=createAuthority(root),staticApi=require(path.join(root,'server/src/services/planet/planetStaticData'));
   service=createService({store,authority,catalogue:id=>buildCatalogue(id,staticApi),settings});
   timer=setInterval(()=>{try{service.reconcile();}catch(e){console.error('[SkyhookPI] reconcile: '+e.message);}},30000);timer.unref();
  }return service;
 }
 const previousLoad=Module._load,previousExtension=Module._extensions['.js'];
 const restorers=[],seen=new WeakSet();
 function hookedExtension(mod,filename){
  const kind=targets.get(canonical(filename));if(!['planet','items','launch','bootstrap'].includes(kind))return previousExtension.apply(this,arguments);
  const originalCompile=mod._compile;
  mod._compile=function(source,file){return originalCompile.call(this,transform(kind,source),file);};
  try{return previousExtension.apply(this,arguments);}finally{mod._compile=originalCompile;}
 }
 function open(s){return rpc?rpc.open(s):'Skyhook PI service is loading.';}
 function hookedLoad(request,parent,isMain){
  const exp=previousLoad.apply(this,arguments);if(!exp||!['function','object'].includes(typeof exp)||Module.isBuiltin(request))return exp;
  let kind;try{kind=targets.get(canonical(Module._resolveFilename(request,parent,isMain)));}catch{return exp;}
  if(!kind||seen.has(exp))return exp;
  if(kind==='rpc'){rpc=installRpc(exp,getService);restorers.push(()=>rpc.restore());}
  if(kind==='packet'){const orig=exp.encodePacket;installPacketHook(exp,compose);const own=exp.encodePacket;restorers.push(()=>{if(exp.encodePacket===own)exp.encodePacket=orig;});}
  if(kind==='chat'||kind==='plain')for(const [name,index]of (kind==='chat'?[['executeChatCommand',1]]:[['broadcastLocalMessage',1],['sendChannelMessage',2]])){
   const original=exp[name];if(typeof original!=='function')continue;
   const wrapped=function(...args){if(typeof args[index]!=='string'||!/^[!/]skyhookpi\s*$/i.test(args[index].trim()))return original.apply(this,args);const reply=open(args[0]);if(kind==='plain')throw Error(reply);const [session,,hub,options={}]=args;if(hub&&options.emitChatFeedback!==false)hub.sendSystemMessage(session,reply,options.feedbackChannel||options.channel||null);return {handled:true,message:reply};};exp[name]=wrapped;restorers.push(()=>{if(exp[name]===wrapped)exp[name]=original;});
  }
  seen.add(exp);return exp;
 }
 function afterCommit(fn,...args){try{fn(...args);}catch(e){fault=e.message;console.error('[SkyhookPI] committed host change; PI paused by storage fault: '+e.message);}}
 const state={active:true,
  beforeItemChanges(...args){if(fault)throw Error('PI_STATE_UNAVAILABLE');return life.beforeItemChanges(...args);},
  afterItemChanges(...args){afterCommit(life.afterItemChanges,...args);},
  beforeOrbitals(...args){if(fault)throw Error('PI_STATE_UNAVAILABLE');return life.beforeOrbitals(...args);},
  afterOrbitals(...args){afterCommit(life.afterOrbitals,...args);},
  startup(){getService().reconcile();console.log('[SkyhookPI] startup reconciliation complete');},
  getService,close(){if(closed)return;closed=true;clearInterval(timer);if(Module._load===hookedLoad)Module._load=previousLoad;if(Module._extensions['.js']===hookedExtension)Module._extensions['.js']=previousExtension;for(const undo of restorers.reverse())undo();store.close();state.active=false;delete globalThis[MARK];}};
 globalThis[MARK]=state;Module._extensions['.js']=hookedExtension;Module._load=hookedLoad;
 process.once('exit',()=>{if(!closed)store.close();});
 console.log('[SkyhookPI] 0.1.7 loaded; !skyhookpi');return state;
}
module.exports={install};
if(process.env.EVEJS_SKYHOOK_PI_NO_AUTOINSTALL!=='1')install();
