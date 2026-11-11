"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const reviewed=require('./reviewed.json');
const EXPECTED_EVEJS_VERSION=reviewed.identity.evejsVersion,EXPECTED_FORK=reviewed.identity.evejsFork;
function readJson(root,relative,label,result){try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'));}catch{result.errors.push(label+' unavailable');return null;}}
function inspectFork(data,label,result,field){
 if(!data||!Object.prototype.hasOwnProperty.call(data,'evejsFork')){result.errors.push('Missing '+label+' evejsFork metadata');return;}
 const fork=data.evejsFork;if(!fork||typeof fork!=='object'||Array.isArray(fork)){result.errors.push('Malformed '+label+' evejsFork metadata');return;}
 result[field]=fork;
 for(const [name,expected] of Object.entries(EXPECTED_FORK)){
  if(!Object.prototype.hasOwnProperty.call(fork,name)){result.errors.push('Missing '+label+' evejsFork.'+name+' (expected '+expected+')');continue;}
  if(typeof fork[name]!=='string'){result.errors.push('Malformed '+label+' evejsFork.'+name+' (expected string '+expected+')');continue;}
  if(fork[name]!==expected)result.errors.push('Unsupported '+label+' evejsFork.'+name+' '+fork[name]+' (expected '+expected+')');
 }
}
function inspectPackageVersion(root,relative,label,result,field){
 const data=readJson(root,relative,label+' package.json',result);if(!data)return;
 if(!Object.prototype.hasOwnProperty.call(data,'version')){result.errors.push('Missing '+label+' EveJS version (expected '+EXPECTED_EVEJS_VERSION+')');return;}
 if(typeof data.version!=='string'){result.errors.push('Malformed '+label+' EveJS version (expected string '+EXPECTED_EVEJS_VERSION+')');return;}
 result[field]=data.version;
 if(data.version!==EXPECTED_EVEJS_VERSION)result.errors.push('Unsupported '+label+' EveJS version '+data.version+' (expected '+EXPECTED_EVEJS_VERSION+')');
 inspectFork(data,label,result,label==='root'?'rootFork':'serverFork');
}
function inspectConfigVersion(root,result){
 const data=readJson(root,'config/version.json','config/version.json',result);if(!data)return;
 if(!Object.prototype.hasOwnProperty.call(data,'evejsVersion')){result.errors.push('Missing config EveJS version (expected '+EXPECTED_EVEJS_VERSION+')');return;}
 if(typeof data.evejsVersion!=='string'){result.errors.push('Malformed config EveJS version (expected string '+EXPECTED_EVEJS_VERSION+')');return;}
 result.configVersion=data.evejsVersion;
 if(data.evejsVersion!==EXPECTED_EVEJS_VERSION)result.errors.push('Unsupported config EveJS version '+data.evejsVersion+' (expected '+EXPECTED_EVEJS_VERSION+')');
}
function inspectRoot(root){
 const result={compatible:true,reviewedUpstream:reviewed.upstream,node:process.versions.node,version:null,serverVersion:null,configVersion:null,rootFork:null,serverFork:null,fingerprints:{},errors:[]};
 inspectPackageVersion(root,'package.json','root',result,'version');
 inspectPackageVersion(root,'server/package.json','server',result,'serverVersion');
 inspectConfigVersion(root,result);
 if(Number(process.versions.node.split('.')[0])<24)result.errors.push('Node.js 24+ required');
 for(const [file,expected] of Object.entries(reviewed.files)){
  try{const src=fs.readFileSync(path.join(root,file),'utf8').split(String.fromCharCode(13,10)).join('\n');const hash=crypto.createHash('sha256').update(src).digest('hex');result.fingerprints[file]=hash;if(!(Array.isArray(expected)?expected:[expected]).includes(hash))result.errors.push('Unreviewed '+file+' ('+hash+')');}catch{result.errors.push('Missing '+file);}
 }
 result.compatible=result.errors.length===0;return result;
}
function assertRoot(root){const result=inspectRoot(root);if(!result.compatible)throw Error(result.errors.join('; '));return result;}
module.exports={inspectRoot,assertRoot};
