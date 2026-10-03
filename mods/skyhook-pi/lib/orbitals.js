"use strict";
const SYMBOL='evejs.skyhook-pi.runtime.v1';
function replaceOnce(source,from,to){if(source.split(from).length!==2)throw Error('SOURCE_SEAM_MISMATCH');return source.replace(from,to);}
function transform(kind,input){
 let source=input.replace(/\r\n/g,'\n');
 if(source.includes('/* skyhook-pi:v1 */'))throw Error('ALREADY_TRANSFORMED');
 const hook=`globalThis[Symbol.for("${SYMBOL}")]`;
 if(kind==='planet') {
   source=replaceOnce(source,'listOrbitalsForSystem(numericSystemID)\n      .map', 'listOrbitalsForSystem(numericSystemID)\n      .filter(record => Number(record.typeID) !== 81080)\n      .map');
   source=replaceOnce(source,'if (listOrbitalsForPlanet(planetID).length > 0)', 'if (listOrbitalsForPlanet(planetID).some(record => Number(record.typeID) !== 81080))');
   // The retail menu and Launchpad both require the Activate component.
   source=replaceOnce(source,'  entity.orbitalHackerID = null;',`  if (Number(record.typeID) === 81080) {
    const piActive = !isOrbitalRecordDestroyed(record) &&
      [ORBITAL_STATE.IDLE, ORBITAL_STATE.OPERATING].includes(record.state);
    entity.component_activate = [piActive,
      record.state === ORBITAL_STATE.ONLINING ? entity.orbitalTimestampMs : null];
  }
  entity.orbitalHackerID = null;`);
   source=replaceOnce(source,'function writeState(state, options = {}) {',`function writeState(state, options = {}) {\n  ${hook}?.beforeOrbitals(state);`);
   source=replaceOnce(source,'  return flushStateToDisk();\n}',`  const piFlushed = flushStateToDisk();\n  if (piFlushed) ${hook}?.afterOrbitals(normalizedState);\n  return piFlushed;\n}`);
 } else if(kind==='broker') {
   source=replaceOnce(source,`      this._normalizeInventoryId(record.groupID, 0) !==
      planetOrbitalState.GROUP_PLANETARY_CUSTOMS_OFFICES`, `      this._normalizeInventoryId(record.groupID, 0) !==
        planetOrbitalState.GROUP_PLANETARY_CUSTOMS_OFFICES &&
      !(Number(record.typeID) === 81080 &&
        [planetOrbitalState.ORBITAL_STATE.IDLE,
         planetOrbitalState.ORBITAL_STATE.OPERATING].includes(record.state))`);
 } else if(kind==='items') {
   source=replaceOnce(source,'    const touchedKeys = new Set([...stagedRows.keys(), ...removedRows]);',`    const touchedKeys = new Set([...stagedRows.keys(), ...removedRows]);\n    ${hook}?.beforeItemChanges(baseItems, items, touchedKeys);`);
   source=replaceOnce(source,'    if (committed) {\n      return true;',`    if (committed) {\n      ${hook}?.afterItemChanges(baseItems, touchedKeys);\n      return true;`);
 } else if(kind==='launch') {
   source=replaceOnce(source,'...buildOrbitalSpawnState(session, context.systemID),', '...buildOrbitalSpawnState(session, context.systemID),\n    ...(sourceTypeID === 81080 ? { skyhookPiInstallerID: context.characterID } : {}),');
 } else if(kind==='bootstrap'){
   source=replaceOnce(source,'  const runtimeContext = createRuntimeContext({ serviceManager, gatewayRuntime });',`  ${hook}?.startup();\n  const runtimeContext = createRuntimeContext({ serviceManager, gatewayRuntime });`);
 } else throw Error('UNKNOWN_TRANSFORM');
 return '/* skyhook-pi:v1 */\n'+source;
}
module.exports={SYMBOL,transform};
