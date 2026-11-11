"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),vm=require("node:vm");
const modRoot=path.resolve(__dirname,"..");
const coreRoot=path.resolve(process.env.EVEJS_ROOT||"C:/projects/EveJS");
const compatibility=require("../lib/compatibility");
const {transform}=require("../lib/orbitals");
const skyDelivery=require("../lib/delivery");
const piDelivery=require("../../pi-processing/lib/delivery");
const read=(relative,root=coreRoot)=>fs.readFileSync(path.join(root,...relative.split("/")),"utf8");
const json=(relative,root=modRoot)=>JSON.parse(read(relative,root));

function fixture(t,crlf=false){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"skyhook-261108-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const relative of ["package.json","server/package.json","config/version.json",...Object.keys(json("lib/reviewed.json").files)]){
  let data=read(relative);if(crlf)data=data.replace(/\r?\n/g,"\r\n");
  const target=path.join(root,...relative.split("/"));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data);
 }
 return root;
}

test("Skyhook PI 0.1.17 targets Core 261108.1",()=>{
 const manifest=json("evejs-launcher.mod.json");
 assert.equal(manifest.version,"0.1.17");
 assert.deepEqual(manifest.compatibility.evejsVersions,["261108.1"]);
 for(const [relative,marker] of [["loader.js","0.1.17 loaded"],["lib/rpc.js","version:'0.1.17'"],["client/companion.py","Skyhook PI 0.1.17"],["README.md","Skyhook PI 0.1.17"]])assert.match(read(relative,modRoot),new RegExp(marker.replaceAll(".","\\.")),relative);
});

test("Skyhook guard accepts exact LF and CRLF Core 261108.1 sources",t=>{
 for(const crlf of [false,true]){
  const result=compatibility.inspectRoot(fixture(t,crlf));
  assert.equal(result.compatible,true,result.errors.join("; "));
  assert.equal(result.version,"261108.1");assert.equal(result.serverVersion,"261108.1");
  assert.equal(result.configVersion,"261108.1");
  assert.deepEqual(result.rootFork,{repository:"erooku/evejs-core",buildVersion:"261109.1",baseVersion:"261108.1"});
  assert.deepEqual(result.serverFork,result.rootFork);
  assert.deepEqual(result.fingerprints,json("lib/reviewed.json").files);
 }
});

test("Skyhook guard rejects the retired Core compatibility identity",t=>{
 const root=fixture(t);fs.writeFileSync(path.join(root,"package.json"),JSON.stringify({version:"261028.1"}));
 const result=compatibility.inspectRoot(root);assert.equal(result.compatible,false);assert.match(result.errors.join("; "),/Unsupported root EveJS version 261028\.1 \(expected 261108\.1\)/);
});

test("Skyhook guard fails closed on wrong or missing config and fork metadata",t=>{
 const cases=[
  ["wrong config",root=>fs.writeFileSync(path.join(root,"config/version.json"),JSON.stringify({evejsVersion:"261028.1",configSchemaVersion:1})),/Unsupported config EveJS version 261028\.1/],
  ["missing config version",root=>fs.writeFileSync(path.join(root,"config/version.json"),JSON.stringify({configSchemaVersion:1})),/Missing config EveJS version/],
  ["wrong root build",root=>{const file=path.join(root,"package.json"),data=JSON.parse(fs.readFileSync(file));data.evejsFork.buildVersion="261110.1";fs.writeFileSync(file,JSON.stringify(data));},/Unsupported root evejsFork\.buildVersion 261110\.1/],
  ["missing root build",root=>{const file=path.join(root,"package.json"),data=JSON.parse(fs.readFileSync(file));delete data.evejsFork.buildVersion;fs.writeFileSync(file,JSON.stringify(data));},/Missing root evejsFork\.buildVersion/],
  ["missing server fork",root=>{const file=path.join(root,"server/package.json"),data=JSON.parse(fs.readFileSync(file));delete data.evejsFork;fs.writeFileSync(file,JSON.stringify(data));},/Missing server evejsFork metadata/],
  ["wrong server repository",root=>{const file=path.join(root,"server/package.json"),data=JSON.parse(fs.readFileSync(file));data.evejsFork.repository="other/evejs-core";fs.writeFileSync(file,JSON.stringify(data));},/Unsupported server evejsFork\.repository other\/evejs-core/],
  ["wrong server base",root=>{const file=path.join(root,"server/package.json"),data=JSON.parse(fs.readFileSync(file));data.evejsFork.baseVersion="261028.1";fs.writeFileSync(file,JSON.stringify(data));},/Unsupported server evejsFork\.baseVersion 261028\.1/],
 ];
 for(const [label,mutate,pattern] of cases){const root=fixture(t);mutate(root);const result=compatibility.inspectRoot(root);assert.equal(result.compatible,false,label);assert.match(result.errors.join("; "),pattern,label);}
});

test("Skyhook transforms exact LF and CRLF Core sources and compiles",()=>{
 for(const [kind,relative] of Object.entries({planet:"server/src/services/planet/planetOrbitalState.js",items:"server/src/services/inventory/itemStore.js",bootstrap:"server/bootstrap.js"})){
  const lf=read(relative).replace(/\r\n/g,"\n"),a=transform(kind,lf),b=transform(kind,lf.replace(/\n/g,"\r\n"));
  assert.equal(b,a,kind);new vm.Script(`(function(require,module,exports,__dirname,__filename){${a}\n})`,{filename:relative});
 }
});

test("Skyhook item seam preserves committed write, GM notification, Dogma invalidation, then contained reconciliation",()=>{
 const events=[];
 const source=`
const baseItems={},items={};const stagedRows=new Map([["1",{}]]),removedRows=new Set();
function noteGmDogmaItemChanges(){events.push("gm");}
function noteDogmaAffectingRowChanges(){events.push("dogma");}
function commit(){
    const touchedKeys = new Set([...stagedRows.keys(), ...removedRows]);
 const originals=new Map(),stampedRows=new Map(),committed=true;
    if (committed) {
      noteGmDogmaItemChanges(originals, stampedRows, removedRows);
      noteDogmaAffectingRowChanges(originals, stampedRows, removedRows);
      return true;
    }
 return false;
}
module.exports={commit};`;
 const marker=Symbol.for("evejs.skyhook-pi.runtime.v1"),prior=globalThis[marker],priorError=console.error;
 globalThis[marker]={beforeItemChanges(){events.push("before");},afterItemChanges(){events.push("mod");throw Error("deferred");}};
 console.error=message=>events.push(`contained:${message}`);
 try{const module={exports:{}};new Function("module","exports","events",transform("items",source))(module,module.exports,events);assert.equal(module.exports.commit(),true);assert.deepEqual(events,["before","gm","dogma","mod","contained:[SkyhookPI] post-commit item reconciliation deferred: deferred"]);}
 finally{console.error=priorError;if(prior===undefined)delete globalThis[marker];else globalThis[marker]=prior;}
});

function packetOrder(deliveries){
 let encoded;const marshal={encodePacket(value){encoded=value;return value;}};
 for(const delivery of deliveries)delivery.installPacketHook(marshal,original=>Buffer.concat([original,Buffer.from(delivery===skyDelivery?"S":"P")]));
 const original=Buffer.from([0x74,1,0,0,0,0x78]);
 const handshake=["",[original,0],{type:"dict",entries:[]},{type:"dict",entries:[["challenge_responsehash","55087"],["macho_version",1]]}];
 marshal.encodePacket(handshake);assert.equal(handshake[1][0],original);assert.equal(encoded[1][1],0);return encoded[1][0].subarray(original.length).toString("ascii");
}
test("Skyhook and PI packet hooks preserve both contributions in either loader order for the current handshake tuple",()=>{
 assert.equal(packetOrder([skyDelivery,piDelivery]),"PS");
 assert.equal(packetOrder([piDelivery,skyDelivery]),"SP");
 assert.equal(skyDelivery.validateRoot(coreRoot),json("lib/reviewed.json").files["server/src/network/tcp/handshake.js"]);
 assert.equal(piDelivery.validateRoot(coreRoot),json("../pi-processing/lib/reviewed.json",modRoot).files["server/src/network/tcp/handshake.js"]);
});
