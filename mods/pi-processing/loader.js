'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {isMainThread}=require('node:worker_threads');
const {assertRoot}=require('./lib/compatibility'),{transformItems,createInventory}=require('./lib/inventory');
const {openStore}=require('./lib/store'),{createService}=require('./lib/service'),{createAuthority}=require('./lib/authority');
const {buildCatalogue}=require('./lib/catalogue'),{createDelivery,installPacketHook}=require('./lib/delivery'),{installRpc}=require('./lib/rpc');
const MARK=Symbol.for('evejs.pi-processing.runtime.v1');
const canonical=p=>fs.realpathSync(p).replace(/\\/g,'/').replace(process.platform==='win32'?/[A-Z]/g:/(?!)/g,c=>c.toLowerCase());
function isWorldProcess(root){try{return isMainThread&&!!process.argv[1]&&canonical(require.resolve(path.resolve(process.argv[1])))===canonical(path.join(root,'server/index.js'));}catch{return false;}}
function install(root=path.resolve(__dirname,'../..')){
  if(!isWorldProcess(root))return {active:false,reason:'not-world-entrypoint'};
  if(globalThis[MARK])return globalThis[MARK];assertRoot(root);
  const files={items:'server/src/services/inventory/itemStore.js',rpc:'server/src/services/planet/planetMgrService.js',packet:'server/src/network/tcp/utils/marshal.js',chat:'server/src/services/chat/chatCommands.js',plain:'server/src/_secondary/chat/chatRuntime.js'};
  const targets=new Map(Object.entries(files).map(([k,v])=>[canonical(path.join(root,v)),k]));
  for(const file of Object.keys(require.cache))if(targets.has(canonical(file)))throw Error('PRELOAD_REQUIRED');
  const compose=createDelivery(__dirname),store=openStore(path.join(root,'_local/mods/pi-processing/state.sqlite'));
  let service,rpc,timer,closed=false,fault=null;
  function getService(){if(closed)throw Error('MOD_CLOSED');if(fault)throw Error('PI_STATE_UNAVAILABLE');if(!service){
    try{const authority=createAuthority(root),inventory=createInventory(root),api=require(path.join(root,'server/src/services/planet/planetStaticData'));
      const candidate=createService({store,authority,inventory,catalogue:buildCatalogue(api)});candidate.reconcile();service=candidate;
      timer=setInterval(()=>{try{service.reconcile();}catch(e){fault=e.message;console.error('[PIProcessing] recovery: '+e.message);}},30000);timer.unref();
    }catch(e){fault=e.message;throw e;}
  }return service;}
  const previousLoad=Module._load,previousExtension=Module._extensions['.js'],seen=new WeakSet(),restorers=[];
  function extension(mod,filename){if(targets.get(canonical(filename))!=='items')return previousExtension.apply(this,arguments);
    const original=mod._compile;mod._compile=function(source,file){return original.call(this,transformItems(source),file);};
    try{return previousExtension.apply(this,arguments);}finally{mod._compile=original;}
  }
  function load(request,parent,isMain){const exp=previousLoad.apply(this,arguments);if(!exp||!['function','object'].includes(typeof exp)||Module.isBuiltin(request))return exp;
    let kind;try{kind=targets.get(canonical(Module._resolveFilename(request,parent,isMain)));}catch{return exp;}if(!kind||seen.has(exp))return exp;
    if(kind==='rpc'){rpc=installRpc(exp,getService);restorers.push(()=>rpc.restore());}
    if(kind==='packet'){const original=exp.encodePacket;installPacketHook(exp,compose);const own=exp.encodePacket;restorers.push(()=>{if(exp.encodePacket===own)exp.encodePacket=original;});}
    if(kind==='chat'||kind==='plain')for(const [name,index]of(kind==='chat'?[['executeChatCommand',1]]:[['broadcastLocalMessage',1],['sendChannelMessage',2]])){
      const original=exp[name];if(typeof original!=='function')continue;
      const wrapped=function(...args){if(typeof args[index]!=='string'||!/^[!/]piprocessing\s*$/i.test(args[index].trim()))return original.apply(this,args);const reply=rpc?rpc.open(args[0]):'PI Processing is loading.';if(kind==='plain')throw Error(reply);const [s,,hub,options={}]=args;if(hub&&options.emitChatFeedback!==false)hub.sendSystemMessage(s,reply,options.feedbackChannel||options.channel||null);return {handled:true,message:reply};};exp[name]=wrapped;restorers.push(()=>{if(exp[name]===wrapped)exp[name]=original;});
    }seen.add(exp);return exp;
  }
  const state={active:true,getService,close(){if(closed)return;closed=true;clearInterval(timer);if(Module._load===load)Module._load=previousLoad;if(Module._extensions['.js']===extension)Module._extensions['.js']=previousExtension;for(const undo of restorers.reverse())undo();store.close();state.active=false;delete globalThis[MARK];}};
  globalThis[MARK]=state;Module._load=load;Module._extensions['.js']=extension;
  process.once('exit',()=>{if(!closed)store.close();});console.log('[PIProcessing] 0.1.1 loaded; !piprocessing');return state;
}
module.exports={install,isWorldProcess};
if(process.env.EVEJS_PI_PROCESSING_NO_AUTOINSTALL!=='1')install();
