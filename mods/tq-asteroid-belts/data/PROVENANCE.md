# TQ manifest provenance

## Pinned dataset

- Client channel: Tranquility (`TQ`)
- Client build: `3632936`
- Build metadata URL: `https://binaries.eveonline.com/eveclient_TQ.json`
- Build descriptor URL: `https://binaries.eveonline.com/eveonline_3632936.txt`
- Build descriptor SHA-256: `379ffe935b0fa8a2a90282ee0a1ecca1930bb0ff284e89bfc150b65e18fd946d`
- Decompressed `resfileindex.txt` SHA-256: `e6feb03ffca8812b40726c33c7789b6bae4b92f0ca1d74c0dcd36158797da3b6`
- Resource: `res:/staticdata/asteroidcountbytypeidbeltid.static`
- Resource index entry:

  ```text
  res:/staticdata/asteroidcountbytypeidbeltid.static,51/5129461fccd30475_37125cf3e730bd50495239a6cda04879,37125cf3e730bd50495239a6cda04879,3974962,516729
  ```

- Decoded resource SHA-256: `74f806cf931de135e2ef4fe1ad2edd2795948bafb4438b815320fb2f8990f520`
- Canonical decompressed manifest SHA-256: `724c44edf514569524d5c652750cf331909c0899d53da570637d076a96b01d9b`

The build-3632936 resource index references the same content-addressed asteroid-count resource present in the locally retained build `3396210`. Extraction used those identical local bytes after verifying the current official index entry.

## Decoded invariants

| Metric | Value |
|---|---:|
| Belt IDs | 40,928 |
| Asteroids | 2,123,854 |
| Belt/type rows | 249,314 |
| Maximum asteroids in one belt | 186 |
| Belt with the maximum | 40161349 |

The 40,928 belt IDs are checked against the EveJS runtime table by `tests/tq-asteroid-belts/verify.js`. Every referenced asteroid type is checked through EveJS `resolveItemByTypeID` and must classify as `ore`.

## Format notes

The client resource is an FSD nested integer dictionary:

```text
beltID -> typeID -> asteroidCount
```

`tools/extract_tq_asteroid_manifest.py` reads the schema-length prefix and the two fixed-size dictionary footers without executing client code. It authenticates the source resource against the size and MD5 recorded in the explicitly supplied authoritative `resfileindex.txt`; the installed client may provide identical content-addressed bytes from an older retained build. The tool hashes and embeds the supplied official build descriptor and resource index, preserves the exact resource-index entry, emits sorted JSON and writes gzip with `mtime=0`. Runtime additionally pins the SHA-256 of the complete decompressed manifest, so changing per-belt rows while preserving aggregate statistics is rejected.

The manifest is evidence for composition and count only. It does not contain asteroid positions, radii, ore quantities, respawn timers or depletion state.
