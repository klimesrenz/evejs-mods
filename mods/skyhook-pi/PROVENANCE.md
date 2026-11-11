# Provenance — Skyhook PI 0.1.17

- Canonical source: `klimesrenz/evejs-mods`, `mods/skyhook-pi`.
- Recovery lineage: the previous `0.1.16` compatibility candidate had been derived from the installed `SkyhookPI-0.1.15` package in `C:/projects/EveJS-Mod-Compatibility-261108.1/SkyhookPI-0.1.16`; those changes were restored into the canonical source tree before this release.
- Reviewed Core: compatibility `261108.1`, fork build `261109.1`, commit `e7b2f092eff3cf6ecd7838ee899b08c438707eff`.
- Guard encoding: SHA-256 of UTF-8 source normalized from CRLF to LF; exact values are in `lib/reviewed.json`.
- Scope: source candidate and deterministic package. Nothing was installed, enabled, or written into a live data tree.

## Guard review

Every guarded file was read at the pinned Core commit. The retained contracts are:

- `planetOrbitalState.js`: `writeState` pre-commit veto and durable `normalizedState` post-commit seam.
- `itemStore.js`: mutation-plan `touchedKeys`; committed-write order is GM Dogma notification, Dogma invalidation, then the contained mod reconciliation hook.
- `planetStaticData.js`: PI type, dogma and schematic readers used by the catalogue.
- `planetMgrService.js`: service class patched with the mod RPC handlers.
- `specialShipHoldRegistry.js`: authoritative special-hold capacity/type rules.
- `corporationState.js`, `corporationRuntimeState.js`, `characterState.js`: corporation identity/roles and inventory session notification contracts.
- `handshake.js`: current CryptoServerHandshake tuple uses `[signedFunc, 0]`; client payload composition preserves that exact signature value.
- `bootstrap.js`: startup insertion remains immediately before runtime-context construction.
- `skyhookOfficeReplacement.js`: native replacement intent used to resolve installer provenance.
- `worldData.js`, `fittingRuntime.js`, `liveFittingState.js`, `space/runtime.js`, `cargoContainerRuntime.js`: location, fitting, range, scene and cargo authority exports consumed by `lib/authority.js`.
- `marshal.js`, `chatCommands.js`, `chatRuntime.js`, `sessionIdentity.js`: packet, command and canonical session identity entrypoints.

The item transform is mandatory in 0.1.17. It preserves the committed Core mutation and both Core Dogma side effects even when Skyhook reconciliation throws; reconciliation failure remains contained and recoverable.

## Loader performance

Version `0.1.17` caches target classification by the resolved module filename. Both the global load hook and the JavaScript extension hook reuse that classification, so repeated `require()` calls no longer repeat synchronous filesystem canonicalization for the same target or non-target path. Canonicalization remains fail-closed for each newly observed resolved filename; Skyhook gameplay and persistent state formats are unchanged.
