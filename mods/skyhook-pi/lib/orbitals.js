"use strict";
const SYMBOL='evejs.skyhook-pi.runtime.v1';
function replaceOnce(source,from,to){if(source.split(from).length!==2)throw Error('SOURCE_SEAM_MISMATCH');return source.replace(from,to);}
function transform(kind,input){
 let source=input.replace(/\r\n/g,'\n');
 if(source.includes('/* skyhook-pi:v1 */'))throw Error('ALREADY_TRANSFORMED');
 const hook=`globalThis[Symbol.for("${SYMBOL}")]`;
 if(kind==='planet') {
   source=replaceOnce(source,'function writeState(state, options = {}) {',`function writeState(state, options = {}) {\n  ${hook}?.beforeOrbitals(state);`);
   source=replaceOnce(source,'  if (durable && (resourceRowsChanged || settledPendingResourceWrite)) settle();\n  return durable;',`  if (durable && (resourceRowsChanged || settledPendingResourceWrite)) settle();\n  if (durable) ${hook}?.afterOrbitals(normalizedState);\n  return durable;`);
 } else if(kind==='items') {
   source=replaceOnce(source,'    const touchedKeys = new Set([...stagedRows.keys(), ...removedRows]);',`    const touchedKeys = new Set([...stagedRows.keys(), ...removedRows]);\n    ${hook}?.beforeItemChanges(baseItems, items, touchedKeys);`);
   source=replaceOnce(source,'    if (committed) {\n      return true;',`    if (committed) {\n      ${hook}?.afterItemChanges(baseItems, touchedKeys);\n      return true;`);
 } else if(kind==='bootstrap'){
   source=replaceOnce(source,'  const runtimeContext = createRuntimeContext({ serviceManager, gatewayRuntime });',`  ${hook}?.startup();\n  const runtimeContext = createRuntimeContext({ serviceManager, gatewayRuntime });`);
 } else throw Error('UNKNOWN_TRANSFORM');
 return '/* skyhook-pi:v1 */\n'+source;
}
module.exports={SYMBOL,transform};
