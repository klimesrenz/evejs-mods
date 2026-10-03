"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const reviewed=require('./reviewed.json');
function inspectRoot(root){
 const result={compatible:true,reviewedUpstream:reviewed.upstream,node:process.versions.node,version:null,fingerprints:{},errors:[]};
 try{result.version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;}catch{result.errors.push('package.json unavailable');}
 if(Number(process.versions.node.split('.')[0])<24)result.errors.push('Node.js 24+ required');
 for(const [file,expected] of Object.entries(reviewed.files)){
  try{const src=fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');const hash=crypto.createHash('sha256').update(src).digest('hex');result.fingerprints[file]=hash;if(!(Array.isArray(expected)?expected:[expected]).includes(hash))result.errors.push('Unreviewed '+file+' ('+hash+')');}catch{result.errors.push('Missing '+file);}
 }
 result.compatible=result.errors.length===0;return result;
}
function assertRoot(root){const result=inspectRoot(root);if(!result.compatible)throw Error(result.errors.join('; '));return result;}
module.exports={inspectRoot,assertRoot};
