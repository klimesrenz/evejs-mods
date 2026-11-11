"use strict";
const crypto=require("node:crypto"),fs=require("node:fs"),path=require("node:path");
const ROOT=path.resolve(__dirname,".."),ALLOWLIST=path.join(__dirname,"package-files.json"),SNAPSHOT=path.join(ROOT,"SOURCE_SNAPSHOT.json"),MANIFEST=path.join(ROOT,"evejs-launcher.mod.json");
const CORE={version:"261108.1",commit:"e7b2f092eff3cf6ecd7838ee899b08c438707eff"};
const TEXT_EXT=new Set([".cjs",".js",".json",".md",".py",".txt"]);
const CRC_TABLE=Array.from({length:256},(_,value)=>{let crc=value;for(let bit=0;bit<8;bit++)crc=(crc&1)?(0xEDB88320^(crc>>>1)):(crc>>>1);return crc>>>0;});
const crc32=buffer=>{let crc=0xFFFFFFFF;for(const byte of buffer)crc=CRC_TABLE[(crc^byte)&255]^(crc>>>8);return (crc^0xFFFFFFFF)>>>0;};
const sha256=buffer=>crypto.createHash("sha256").update(buffer).digest("hex");
function parseJsonUnique(data,label="JSON"){
 const text=Buffer.isBuffer(data)?data.toString("utf8"):String(data);let index=0;
 const fail=message=>{throw Error(`${label}: ${message} at ${index}`);};
 const space=()=>{while(/\s/u.test(text[index]||""))index++;};
 function string(){const start=index;if(text[index++]!=="\"")fail("expected string");while(index<text.length){const char=text[index++];if(char==="\"")return JSON.parse(text.slice(start,index));if(char==="\\"){if(index>=text.length)fail("invalid escape");index++;}}fail("unterminated string");}
 function value(){space();const char=text[index];if(char==="{")return object();if(char==="[")return array();if(char==="\""){string();return;}const start=index;while(index<text.length&&!/[\s,\]}]/u.test(text[index]))index++;if(start===index)fail("expected value");JSON.parse(text.slice(start,index));}
 function object(){index++;space();const keys=new Set();if(text[index]==="}"){index++;return;}for(;;){space();const key=string();if(keys.has(key))fail(`duplicate key ${JSON.stringify(key)}`);keys.add(key);space();if(text[index++]!==":")fail("expected colon");value();space();const char=text[index++];if(char==="}")return;if(char!==",")fail("expected comma");}}
 function array(){index++;space();if(text[index]==="]"){index++;return;}for(;;){value();space();const char=text[index++];if(char==="]")return;if(char!==",")fail("expected comma");}}
 value();space();if(index!==text.length)fail("trailing data");return JSON.parse(text);
}
const rootName=()=>`SkyhookPI-${parseJsonUnique(fs.readFileSync(MANIFEST,"utf8"),"manifest").version}`;
const MAX_ARCHIVE_BYTES=16*1024*1024,MAX_ENTRIES=256,MAX_ENTRY_BYTES=4*1024*1024,MAX_NAME_BYTES=512;
function writeArchive(filename,archive){
 if(archive.length>MAX_ARCHIVE_BYTES)throw Error("archive size refused");const output=path.resolve(filename),relative=path.relative(ROOT,output);
 if(relative===""||(!relative.startsWith(`..${path.sep}`)&&relative!==".."&&!path.isAbsolute(relative)))throw Error("package output inside source root refused");
 if(fs.existsSync(output))throw Error("package output already exists");fs.mkdirSync(path.dirname(output),{recursive:true});
 for(let cursor=path.dirname(output);;cursor=path.dirname(cursor)){if(fs.lstatSync(cursor).isSymbolicLink())throw Error("package output alias refused");if(path.dirname(cursor)===cursor)break;}
 const temporary=`${output}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;fs.writeFileSync(temporary,archive,{flag:"wx"});
 try{fs.linkSync(temporary,output);}finally{fs.rmSync(temporary,{force:true});}return output;
}
const u16=value=>{const b=Buffer.alloc(2);b.writeUInt16LE(value);return b;},u32=value=>{const b=Buffer.alloc(4);b.writeUInt32LE(value>>>0);return b;};
function validateRelativePath(relative){
 if(typeof relative!=="string"||!relative||relative.includes("\\")||path.posix.isAbsolute(relative)||/^[A-Za-z]:/.test(relative))throw Error(`invalid package path refused: ${relative}`);
 const parts=relative.split("/");if(parts.some(part=>!part||part==="."||part===".."))throw Error(`path escape refused: ${relative}`);
 const lower=relative.toLowerCase(),base=parts.at(-1).toLowerCase();
 if(base===".env"||base.startsWith(".env.")||/(^|[._-])(secret|secrets|token|credentials?)([._-]|$)/.test(base)||/\.(log|sqlite|sqlite3|db|pem|key|pfx|p12)$/i.test(lower))throw Error(`forbidden package file refused: ${relative}`);
 return relative;
}
function loadAllowlist(){
 const files=parseJsonUnique(fs.readFileSync(ALLOWLIST,"utf8"),"package allowlist");if(!Array.isArray(files)||files.length===0)throw Error("package allowlist must be a non-empty array");
 const sorted=[...files].sort();if(JSON.stringify(files)!==JSON.stringify(sorted))throw Error("package allowlist must be sorted");
 for(const file of files)validateRelativePath(file);if(new Set(files).size!==files.length)throw Error("package allowlist contains duplicates");return files;
}
function normalizeText(data){return Buffer.from(data.toString("utf8").replace(/\r\n?/g,"\n"),"utf8");}
function readAllowedFile(root,relative){
 validateRelativePath(relative);root=path.resolve(root);const rootReal=fs.realpathSync(root);const absolute=path.resolve(root,...relative.split("/"));
 if(!absolute.startsWith(`${root}${path.sep}`))throw Error(`path escape refused: ${relative}`);
 let cursor=root;for(const part of relative.split("/")){cursor=path.join(cursor,part);const stat=fs.lstatSync(cursor);if(stat.isSymbolicLink())throw Error(`symlink or junction alias refused: ${relative}`);}
 const stat=fs.lstatSync(absolute);if(!stat.isFile())throw Error(`non-regular package file refused: ${relative}`);
 const real=fs.realpathSync(absolute);if(real!==absolute||!real.startsWith(`${rootReal}${path.sep}`))throw Error(`aliased package file refused: ${relative}`);
 const data=fs.readFileSync(absolute);return TEXT_EXT.has(path.extname(relative).toLowerCase())?normalizeText(data):data;
}
function sourceFiles(){return loadAllowlist().map(file=>{const data=readAllowedFile(ROOT,file);if(path.extname(file).toLowerCase()===".json")parseJsonUnique(data,file);return {path:file,data,size:data.length,sha256:sha256(data)};});}
function snapshotObject(files=sourceFiles()){
 const manifest=parseJsonUnique(files.find(file=>file.path==="evejs-launcher.mod.json").data,"manifest");
 return {schemaVersion:1,mod:{id:manifest.id,version:manifest.version},core:CORE,files:files.map(({path,size,sha256})=>({path,size,sha256}))};
}
const encodeSnapshot=value=>Buffer.from(`${JSON.stringify(value,null,2)}\n`,`utf8`);
function writeSnapshot(){const data=encodeSnapshot(snapshotObject());fs.writeFileSync(SNAPSHOT,data);return {path:SNAPSHOT,sha256:sha256(data)};}
function defaultOutput(){return path.join(ROOT,"..","artifacts",`${rootName()}.zip`);}
function buildZip(entries){
 const local=[],central=[];let offset=0;
 for(const entry of entries){const name=Buffer.from(entry.name,"utf8"),crc=crc32(entry.data);const header=Buffer.concat([u32(0x04034B50),u16(20),u16(0x0800),u16(0),u16(0),u16(0x21),u32(crc),u32(entry.data.length),u32(entry.data.length),u16(name.length),u16(0),name]);local.push(header,entry.data);central.push(Buffer.concat([u32(0x02014B50),u16(20),u16(20),u16(0x0800),u16(0),u16(0),u16(0x21),u32(crc),u32(entry.data.length),u32(entry.data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name]));offset+=header.length+entry.data.length;}
 const directory=Buffer.concat(central);return Buffer.concat([...local,directory,u32(0x06054B50),u16(0),u16(0),u16(entries.length),u16(entries.length),u32(directory.length),u32(offset),u16(0)]);
}
function buildPackage(output){
 const files=sourceFiles(),snapshot=encodeSnapshot(snapshotObject(files)),name=rootName();if(!fs.existsSync(SNAPSHOT)||!fs.readFileSync(SNAPSHOT).equals(snapshot))throw Error("SOURCE_SNAPSHOT.json is stale; run package.js snapshot");
 const entries=files.map(file=>({name:`${name}/${file.path}`,data:file.data}));entries.push({name:`${name}/SOURCE_SNAPSHOT.json`,data:snapshot});entries.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
 output=writeArchive(output||defaultOutput(),buildZip(entries));const archive=fs.readFileSync(output);return {output,bytes:archive.length,sha256:sha256(archive),entries:entries.length};
}
function parseZip(archive){
 const entries=[];let offset=0,total=0;while(offset+4<=archive.length&&archive.readUInt32LE(offset)===0x04034B50){if(entries.length>=MAX_ENTRIES||offset+30>archive.length)throw Error("archive limits exceeded");const flags=archive.readUInt16LE(offset+6),method=archive.readUInt16LE(offset+8),time=archive.readUInt16LE(offset+10),date=archive.readUInt16LE(offset+12),crc=archive.readUInt32LE(offset+14),compressed=archive.readUInt32LE(offset+18),size=archive.readUInt32LE(offset+22),nameLen=archive.readUInt16LE(offset+26),extraLen=archive.readUInt16LE(offset+28);total+=size;if(nameLen>MAX_NAME_BYTES||size>MAX_ENTRY_BYTES||total>MAX_ARCHIVE_BYTES||flags!==0x0800||method!==0||time!==0||date!==0x21||compressed!==size||extraLen!==0)throw Error("archive metadata or limits refused");const start=offset+30+nameLen,end=start+size;if(end>archive.length)throw Error("invalid archive length");const name=archive.subarray(offset+30,offset+30+nameLen).toString("utf8"),data=archive.subarray(start,end);if(crc32(data)!==crc)throw Error(`CRC mismatch: ${name}`);entries.push({name,data:Buffer.from(data)});offset=end;}
 if(entries.length===0||!buildZip(entries).equals(archive))throw Error("archive structure or fixed metadata mismatch");return entries;
}
function verifyPackage(filename){
 filename=path.resolve(filename);const stat=fs.statSync(filename);if(!stat.isFile()||stat.size>MAX_ARCHIVE_BYTES)throw Error("archive size refused");const archive=fs.readFileSync(filename),entries=parseZip(archive),prefix=`${rootName()}/`;if(entries.some(entry=>!entry.name.startsWith(prefix)||entry.name===prefix||entry.name.slice(prefix.length).includes("/../")))throw Error("archive is not a single safe root");
 const names=entries.map(entry=>entry.name),expected=[...loadAllowlist(),"SOURCE_SNAPSHOT.json"].map(file=>prefix+file).sort();if(JSON.stringify(names)!==JSON.stringify(expected)||new Set(names).size!==names.length)throw Error("archive entry allowlist mismatch");
 const byName=new Map(entries.map(entry=>[entry.name,entry.data])),manifest=parseJsonUnique(byName.get(prefix+"evejs-launcher.mod.json"),"embedded manifest"),snapshot=parseJsonUnique(byName.get(prefix+"SOURCE_SNAPSHOT.json"),"embedded snapshot");
 const embeddedFiles=loadAllowlist().map(file=>{const data=byName.get(prefix+file);if(path.extname(file).toLowerCase()===".json")parseJsonUnique(data,`embedded ${file}`);return {path:file,size:data.length,sha256:sha256(data)};});const expectedSnapshot=snapshotObject(embeddedFiles.map(file=>({...file,data:byName.get(prefix+file.path)})));
 if(JSON.stringify(snapshot)!==JSON.stringify(expectedSnapshot))throw Error("embedded source snapshot mismatch");if(!fs.existsSync(SNAPSHOT)||!byName.get(prefix+"SOURCE_SNAPSHOT.json").equals(fs.readFileSync(SNAPSHOT)))throw Error("archive snapshot is not current");
 for(const file of sourceFiles()){if(!byName.get(prefix+file.path).equals(file.data))throw Error(`archive source hash mismatch: ${file.path}`);}
 return {filename,bytes:archive.length,sha256:sha256(archive),entries:entries.length,root:prefix,manifest,snapshot};
}
if(require.main===module){try{const command=process.argv[2];let result;if(command==="snapshot")result=writeSnapshot();else if(command==="build")result=buildPackage(process.argv[3]);else if(command==="verify")result=verifyPackage(process.argv[3]);else throw Error("usage: node scripts/package.js snapshot | build [zip] | verify <zip>");process.stdout.write(`${JSON.stringify(result)}\n`);}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={buildPackage,defaultOutput,loadAllowlist,normalizeText,parseJsonUnique,readAllowedFile,validateRelativePath,verifyPackage,writeSnapshot};
