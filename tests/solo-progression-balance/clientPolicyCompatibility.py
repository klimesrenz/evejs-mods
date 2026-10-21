import importlib.util
from pathlib import Path
import sys

sys.dont_write_bytecode = True

adapter_path = Path(__file__).resolve().parents[2] / "mods" / "solo-progression-balance" / "simulation" / "client" / "adapter.py"
spec = importlib.util.spec_from_file_location("solo_fitting_adapter", adapter_path)
assert spec is not None and spec.loader is not None
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)

policy = {
    "schema": 1,
    "evejs": "261018.1",
    "clientBuild": 3396210,
    "revision": "0" * 64,
    "providers": {
        "soloprogressionbalance": {
            "schema": 1,
            "capacityPrograms": [],
            "ships": {},
            "miningAttribute": 77,
            "moduleTypes": [],
            "moduleScale": 3,
            "droneTypes": [],
            "droneScale": 3,
        }
    },
}

assert adapter.validate_policy(policy) is not None, "current EveJS policy must be accepted by the client adapter"
print("PASS client adapter accepts EveJS 261018.1 policy")
