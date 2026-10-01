"use strict";
const path=require('node:path');
const {inspectRoot}=require('./lib/compatibility');
const i=process.argv.indexOf('--root');
const result=inspectRoot(path.resolve(i>=0?process.argv[i+1]:'.'));
console.log(JSON.stringify(result,null,2));process.exitCode=result.compatible?0:1;
