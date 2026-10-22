# EveJS TQ Asteroid Belts

Native EveJS loader mod that replaces procedural standard-belt ore selection and asteroid counts with the per-belt manifest shipped by the EVE Online Tranquility client.

## Current scope

Version `0.1.0` reproduces, for every standard asteroid belt known to EveJS:

- the exact asteroid count for the belt;
- the exact count of every ore type in that belt;
- deterministic type placement across the existing EveJS curved field;
- stable EveJS asteroid item IDs and the existing mining persistence lifecycle.

The pinned manifest contains:

- TQ client build: `3632936`;
- belt records: `40,928`;
- asteroids: `2,123,854`;
- belt/type rows: `249,314`;
- largest belt: `186` asteroids (`40161349`).

This first version intentionally does **not** claim exact TQ coordinates, visual radii, or ore quantity inside each rock. EveJS still supplies field geometry, visuals and quantity estimation. Those are separate parity stages.

## Compatibility

- EveJS native backend `0.12.9` / core release `261018.1`.
- `FourModeAsteroidBelts` is mutually exclusive. Both mods own the same asteroid-population seam. The Launcher manifest declares the conflict and manual preload composition also fails closed.
- Belts absent from the pinned TQ manifest, such as custom mod-created belts, retain native EveJS generation.
- No SQLite file is edited by the loader.

## Installation

1. Keep `FourModeAsteroidBelts` disabled.
2. In **EveJS Launcher → Mods → Add ZIP**, select `TQAsteroidBelts-0.1.0.zip`.
3. Enable **TQ Asteroid Belts** and restart the Game server.

A manual native server can preload `loader.js` with Node `--require` before any EveJS asteroid module is loaded. When the mod is not located at `<EveJS>/mods/<mod-id>`, also set `EVEJS_TQ_ASTEROID_BELTS_RUNTIME_ROOT` to the EveJS root:

```bash
EVEJS_TQ_ASTEROID_BELTS_RUNTIME_ROOT=C:/path/to/EveJS \
NODE_OPTIONS=--require=C:/path/to/EveJS/mods/tqasteroidbelts/loader.js \
node server/src/index.js
```

## Verification

From the `evejs-mods` repository root:

```bash
node --test tests/tq-asteroid-belts/*.test.js
python -m unittest discover -s tests/tq-asteroid-belts -p "test_*.py"
node tests/tq-asteroid-belts/verify.js C:/projects/EveJS
```

The verifier checks the source-transform preflight, compiles the transformed module, validates all 40,928 manifest belt IDs and all ore type IDs against the current EveJS runtime, then materializes belt `40009129` and compares its exact type histogram.

## Rebuilding the manifest

Given an installed EVE client:

```bash
python tools/extract_tq_asteroid_manifest.py \
  --client-tq C:/path/to/EVE/tq \
  --client-build 3632936 \
  --build-descriptor C:/path/to/eveonline_3632936.txt \
  --resource-index C:/path/to/resfileindex.3632936.txt \
  --output mods/tq-asteroid-belts/data/asteroid-counts.json.gz
```

Do not change only `--client-build` to relabel old data. Confirm the resource entry in that build's official `resfileindex.txt`, record its hashes, regenerate the manifest and rerun the verifier. See [`data/PROVENANCE.md`](data/PROVENANCE.md).

## Design notes

The loader transforms only `populateBeltField` in `asteroidService.js`, guarded by the SHA-256 of the owned semantic seam. Unrelated source edits are preserved; changed, duplicate or previously transformed seams are rejected. The manifest is validated at startup, including its declared aggregate statistics and the EveJS 512-ID per-belt stride limit.

The loader/hook and fail-closed source-transform structure was adapted from [EveJS-FourModeAsteroidBelts](https://github.com/Delta007a/EveJS-FourModeAsteroidBelts), also licensed under AGPL-3.0-only.

## License

AGPL-3.0-only. See [`LICENSE`](LICENSE).
