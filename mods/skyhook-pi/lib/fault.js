"use strict";

const SKYHOOK_TYPE_ID = 81080;

function createFaultPolicy(knownItemIDs = []) {
  let fault = null;
  const known = new Set([...knownItemIDs].map(Number).filter(Number.isSafeInteger));

  function replaceKnownItemIDs(itemIDs) {
    known.clear();
    for (const itemID of itemIDs) if (Number.isSafeInteger(Number(itemID))) known.add(Number(itemID));
  }

  function affectedItemChanges(before, after, touched) {
    for (const rawID of touched || []) {
      const itemID = Number(rawID);
      const key = String(rawID);
      if (known.has(itemID) || Number(before?.[key]?.typeID) === SKYHOOK_TYPE_ID ||
          Number(after?.[key]?.typeID) === SKYHOOK_TYPE_ID) return true;
    }
    return false;
  }

  return {
    message() { return fault; },
    record(error) { fault = String(error?.message || error); },
    reconcile(fn) {
      try {
        const result = fn();
        if (result?.itemIDs) replaceKnownItemIDs(result.itemIDs);
        fault = null;
        return result;
      } catch (error) {
        fault = String(error?.message || error);
        throw error;
      }
    },
    replaceKnownItemIDs,
    affectedItemChanges,
    beforeItemChanges(before, after, touched) {
      if (!fault) return true;
      if (affectedItemChanges(before, after, touched)) throw Error("PI_STATE_UNAVAILABLE");
      return false;
    },
    beforeOrbitals() {
      if (fault) throw Error("PI_STATE_UNAVAILABLE");
      return true;
    },
  };
}

module.exports = { createFaultPolicy };
