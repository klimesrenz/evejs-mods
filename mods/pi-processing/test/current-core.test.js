"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const modRoot=path.resolve(__dirname,"..");
const coreRoot=path.resolve(process.env.EVEJS_ROOT||"C:/projects/EveJS");
const compatibility=require("../lib/compatibility");
const {createInventory,classifyReceipt}=require("../lib/inventory");
const {createService}=require("../lib/service");
const piDelivery=require("../lib/delivery");
const skyDelivery=require("../../skyhook-pi/lib/delivery");
const read=(relative,root=coreRoot)=>fs.readFileSync(path.join(root,...relative.split("/")),"utf8");
const json=(relative,root=modRoot)=>JSON.parse(read(relative,root));

function fixture(t,crlf=false){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"pi-processing-261108-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const relative of ["package.json","server/package.json","config/version.json",...Object.keys(json("lib/reviewed.json").files)]){
  let data=read(relative);if(crlf)data=data.replace(/\r?\n/g,"\r\n");
  const target=path.join(root,...relative.split("/"));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data);
 }
 return root;
}

test("PI Processing 0.1.7 targets Core 261108.1",()=>{
 const manifest=json("evejs-launcher.mod.json");assert.equal(manifest.version,"0.1.7");assert.deepEqual(manifest.compatibility.evejsVersions,["261108.1"]);
 for(const [relative,marker] of [["loader.js","0.1.7 loaded"],["lib/rpc.js","version:'0.1.7'"],["client/companion.py","0.1.7"],["README.md","0.1.7"]])assert.match(read(relative,modRoot),new RegExp(marker.replaceAll(".","\\.")),relative);
});

test("PI Processing guard accepts exact LF and CRLF Core 261108.1 sources",t=>{
 for(const crlf of [false,true]){const result=compatibility.inspectRoot(fixture(t,crlf));assert.equal(result.compatible,true,result.errors.join("; "));assert.equal(result.configVersion,"261108.1");assert.deepEqual(result.rootFork,{repository:"erooku/evejs-core",buildVersion:"261109.1",baseVersion:"261108.1"});assert.deepEqual(result.serverFork,result.rootFork);assert.deepEqual(result.fingerprints,json("lib/reviewed.json").files);}
});

test("PI Processing guard rejects the retired Core compatibility identity",t=>{
 const root=fixture(t);fs.writeFileSync(path.join(root,"server/package.json"),JSON.stringify({version:"261028.1"}));
 const result=compatibility.inspectRoot(root);assert.equal(result.compatible,false);assert.match(result.errors.join("; "),/Unsupported server EveJS version 261028\.1 \(expected 261108\.1\)/);
});

test("PI Processing guard fails closed on wrong or missing config and fork metadata",t=>{
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

function packetOrder(deliveries){
 let encoded;const marshal={encodePacket(value){encoded=value;return value;}};
 for(const delivery of deliveries)delivery.installPacketHook(marshal,original=>Buffer.concat([original,Buffer.from(delivery===skyDelivery?"S":"P")]));
 const original=Buffer.from([0x74,1,0,0,0,0x78]);
 const handshake=["",[original,0],{type:"dict",entries:[]},{type:"dict",entries:[["challenge_responsehash","55087"],["macho_version",1]]}];
 marshal.encodePacket(handshake);assert.equal(handshake[1][0],original);assert.equal(encoded[1][1],0);return encoded[1][0].subarray(original.length).toString("ascii");
}
test("PI Processing and Skyhook packet hooks preserve both contributions in either loader order",()=>{
 assert.equal(packetOrder([skyDelivery,piDelivery]),"PS");
 assert.equal(packetOrder([piDelivery,skyDelivery]),"SP");
});

test("PI Processing uses native Core exchange with empty outputs and no itemStore compiler hook",t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"pi-inventory-core-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const calls=[];
 const modules={
  "services/inventory/itemStore.js":`module.exports={exchangeInventoryItemStacksIdempotent(...args){global.__piCalls.push(args);return {success:true,durable:true,duplicate:false,data:{changes:[{item:{itemID:1},previousState:{}}]}};},getIdempotentGrantReceipt(){return {success:true,found:false,durable:false};},grantItemsToOwnerLocationIdempotent(){return {success:true,data:{changes:[]}};}};`,
  "services/character/characterState.js":"module.exports={syncInventoryItemForSession(){}};",
 };
 for(const [relative,source] of Object.entries(modules)){const target=path.join(root,"server/src",relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,source);}
 global.__piCalls=calls;t.after(()=>delete global.__piCalls);
 const inventory=createInventory(root),intent={key:"consume-1",startedAtMs:100,requests:[{itemID:1,quantity:2}],fingerprint:{ownerID:7}};
 assert.equal(inventory.consume(intent).ok,true);assert.deepEqual(calls,[[intent.requests,[],{receiptKey:intent.key,fingerprint:intent.fingerprint,completedAtMs:intent.startedAtMs}]]);
 const loader=read("loader.js",modRoot);assert.doesNotMatch(loader,/Module\._extensions|_compile|transformItems|kind\)!==['"]items/u);assert.doesNotMatch(loader,/items:'server\/src\/services\/inventory\/itemStore\.js'/u);
 assert.equal(Object.hasOwn(require("../lib/inventory"),"transformItems"),false);
});

function harness(receipt,consumeResult={ok:true,durable:true,duplicate:false,changes:[]}){
 let job,consumeCalls=0,grantCalls=0,now=100;const requests=new Map();
 const store={transaction(fn){return fn();},saveJob(value){job=structuredClone(value);},getJob(){return job&&structuredClone(job);},saveRequest(value){requests.set(`${value.ownerID}:${value.id}`,structuredClone(value));},getRequest(ownerID,id){const value=requests.get(`${ownerID}:${id}`);return value&&{payload:value.payload,jobID:value.jobID};},pending(){return job?[structuredClone(job)]:[];},listJobs(){return job?[structuredClone(job)]:[];}};
 const authority={identity(){return 7;},dock(){return {ownerID:7,locationID:6001,locationKind:"station",flagID:4};},available(){return {totals:new Map([[2393,100]])};},select(){return [{itemID:11,quantity:10,expectedTypeID:2393,expectedOwnerID:7,expectedLocationID:6001,expectedFlagID:4,expectedQuantity:100}];},exists(){return true;}};
 const inventory={consume(){consumeCalls++;return consumeResult;},receipt(){return typeof receipt==="function"?receipt(job):receipt;},grant(){grantCalls++;return {ok:true};},notify(){}};
 const catalogue=[{schematicID:1,tier:2,cycleMs:1000,inputs:[{typeID:2393,quantity:10}],outputs:[{typeID:44,quantity:5}]}];
 return {service:createService({store,authority,inventory,catalogue,clock:()=>now}),setNow(value){now=value;},get job(){return job;},counts:()=>({consumeCalls,grantCalls})};
}

test("PI Processing accepts a duplicate native consume receipt without producing output early",()=>{
 const h=harness(job=>({state:"completed",receipt:{fingerprint:job.consumeIntent.fingerprint}}),{ok:true,durable:true,duplicate:true,changes:[]});
 const result=h.service.start({}, {schematicID:1,batches:1,requestID:"request-0001"});assert.equal(result.job.status,"running");assert.deepEqual(h.counts(),{consumeCalls:1,grantCalls:0});assert.equal(result.job.finishAtMs,1100);
});

test("PI Processing retains a conflicting consume receipt for operator recovery",()=>{
 const h=harness({state:"completed",receipt:{fingerprint:{ownerID:999}}});const result=h.service.start({}, {schematicID:1,batches:1,requestID:"request-0002"});assert.equal(result.job.status,"starting");assert.equal(result.job.code,"RECEIPT_MISMATCH");assert.deepEqual(h.counts(),{consumeCalls:1,grantCalls:0});
});

test("PI Processing rejects an authoritatively absent consume receipt",()=>{
 const h=harness({state:"absent"});const result=h.service.start({}, {schematicID:1,batches:1,requestID:"request-0003"});assert.equal(result.job.status,"rejected");assert.equal(result.job.code,"START_NOT_COMMITTED");assert.deepEqual(h.counts(),{consumeCalls:1,grantCalls:0});
});

test("PI Processing keeps outputs delayed and recovers the separate grant receipt",()=>{
 const h=harness(job=>job.status==="delivering"
  ?{state:"completed",receipt:{ownerID:job.ownerID,locationID:job.locationID,flagID:job.flagID,manifest:job.outputs.slice().sort((a,b)=>a.typeID-b.typeID)}}
  :{state:"completed",receipt:{fingerprint:job.consumeIntent.fingerprint}});
 const started=h.service.start({}, {schematicID:1,batches:1,requestID:"request-0004"});
 assert.equal(started.job.status,"running");assert.equal(started.job.finishAtMs,1100);assert.deepEqual(h.counts(),{consumeCalls:1,grantCalls:0});
 assert.throws(()=>h.service.collect({}, {jobID:started.job.id,requestID:"collect-0004"}),/JOB_NOT_READY/);
 h.setNow(1100);const collected=h.service.collect({}, {jobID:started.job.id,requestID:"collect-0004"});
 assert.equal(collected.job.status,"delivered");assert.deepEqual(h.counts(),{consumeCalls:1,grantCalls:1});
});

test("PI Processing receipt classification treats successful absence before durability",()=>{
 assert.deepEqual(classifyReceipt({success:true,found:false,durable:false}),{state:"absent"});assert.deepEqual(classifyReceipt({success:true,found:true,durable:false}),{state:"uncertain"});
});
