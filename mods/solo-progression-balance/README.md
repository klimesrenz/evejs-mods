# SoloProgressionBalance 0.5.0

Configurable server-side scaling for mining modules, mining drones, mining holds and applicable logistics/support cargo. Supports native **EveJS 261018.1 only**. Native ship, skill, module and environmental Dogma modifiers are preserved, with Solo scaling applied once.

Version 0.5.0 ports the strict gameplay and simulation compatibility gates to EveJS 261018.1. Automatic **Fitting > Simulate** support remains available for relevant hold/cargo capacities and mining-module/drone output tooltips. Login delivery now composes with AutoMining instead of competing for the handshake transform, and accepts bounded combined payloads up to 512 KiB. No separate companion is required. Actual gameplay remains server-authoritative.

**Install and configure.** Download `EveJS-SoloProgressionBalance-0.5.0.zip` from Releases. In **EveJS Launcher 1.0.69 or newer > Mods > Add ZIP**, select it, enable SoloProgressionBalance and open Configure. Turn on Enable Solo scaling, set the four multipliers, restart the Game server and reconnect a fresh EVE client. The ZIP starts disabled. Default multipliers are 3x mining modules, 3x mining drones, 3x mining holds and 2x logistics cargo; scaling remains off until enabled. These are configurable multipliers, not fixed ship values.

Launcher writes `mods/soloProgressionBalance/settings.json` and preserves it during updates. For older installations, transfer personal `.env` settings into JSON before replacing the package. Configuration precedence remains nonempty process environment, `settings.json`, legacy `.env`, then defaults. `.env.example` lists the supported variables. Values must be finite and positive; `1` keeps native scaling for that category. Verbose logging is an advanced field.

**Simulation compatibility.** Currently verified only on **EveJS 261018.1 / EVE client build 3396210 / Launcher 1.0.69 or newer**. Mining output uses fresh native effective ghost Dogma before Solo scaling, preserving skills, hull bonuses, module states and Industrial Core effects without compounding. Holds are changed only where the existing Solo rules apply; missing holds are not created. SoloProgressionBalance and DroneClassBalance 0.2.1 can be used together; either also works alone. AutoMining 1.2.18 can own the handshake source transform while Solo appends its companion through AutoMining's delivery composer. Disable/remove the historical standalone Fitting Simulation Companion before using this release.

Unsupported client/server seams, missing compatible Launcher delivery or invalid policy safely retain native simulation; normal server gameplay continues. If AutoMining is present but does not expose its reviewed delivery composer, Solo leaves its handshake transform untouched and retains native simulation. Arbitrary third-party client hooks are not certified. Settings changes require a server restart and fresh client reconnect. The specialized-hold hover readout is optional if its UI seam is incompatible; native tooltip rounding remains unchanged.

**Removal.** Close clients gracefully, stop the server, disable SoloProgressionBalance in Launcher, then restart and reconnect. Client hooks are transient; no vendor files need restoration. Back up `settings.json` before Launcher Remove, which removes the package and local settings. Manual server gameplay can still preload `mods/soloProgressionBalance/loader.js` with Node `--require` before EveJS loads; automatic simulation delivery uses Launcher.

License: AGPL-3.0-only. EveJS itself is AGPL-3.0-only; no vendor source is included in this package.

Исходная версия и перечень изменений maintained-релиза указаны в [`UPSTREAM.md`](UPSTREAM.md).
