"""Regression checks for release package path safety."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
module_path = Path(__file__).resolve().parents[1] / "tools" / "build_release.py"
spec = importlib.util.spec_from_file_location("evejs_build_release", module_path)
assert spec is not None and spec.loader is not None
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

with tempfile.TemporaryDirectory(prefix="evejs-build-safety-") as directory:
    source = Path(directory) / "mod"
    accepted = [
        source / "lib" / "safe.json",
        source / "data" / "asteroid-counts.json.gz",
        source / ".env.example",
        source / "LICENSE",
    ]
    rejected = [
        source / "settings.json",
        source / "Settings.json",
        source / "_local" / "simulation-capability.json",
        source / "_Local" / "state.json",
        source / "__pycache__" / "cache.json",
        source / "__PyCache__" / "cache.json",
        source / ".git" / ".env.example",
        source / "nested" / ".env.example",
        source / "nested" / "LICENSE",
        source / ".hidden" / "safe.json",
        source / "data" / "unreviewed.gz",
    ]
    for file in accepted + rejected:
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text("{}", encoding="utf-8")

    for safe_file in accepted:
        builder.validate_package_file(source, safe_file)
    for runtime_file in rejected:
        try:
            builder.validate_package_file(source, runtime_file)
        except ValueError as error:
            assert "package path" in str(error) or "package file" in str(error)
        else:
            raise AssertionError(f"runtime/user file was accepted: {runtime_file}")

    link = source / "linked.json"
    try:
        link.symlink_to(accepted[0])
    except OSError:
        print("SKIP symlink path check (symlink creation unavailable)")
    else:
        try:
            builder.validate_package_file(source, link)
        except ValueError as error:
            assert "Unexpected package file" in str(error)
        else:
            raise AssertionError("symlink file was accepted")

    directory_link = source / "linked-directory"
    try:
        directory_link.symlink_to(accepted[0].parent, target_is_directory=True)
    except OSError:
        print("SKIP symlink directory check (symlink creation unavailable)")
    else:
        try:
            builder.validate_package_file(source, directory_link)
        except ValueError as error:
            assert "Unexpected package file" in str(error)
        else:
            raise AssertionError("symlink directory was accepted")

    hidden_alias = source / "alias"
    hidden_target = source / ".hidden"
    hidden_junction = subprocess.run(
        ["cmd.exe", "/c", "mklink", "/J", str(hidden_alias), str(hidden_target)],
        capture_output=True,
    )
    if hidden_junction.returncode != 0:
        print("SKIP in-root hidden junction check (junction creation unavailable)")
    else:
        try:
            builder.validate_package_file(source, hidden_alias / "safe.json")
        except ValueError as error:
            assert "Hidden/runtime package path" in str(error)
        else:
            raise AssertionError("junction alias to an in-root hidden directory was accepted")
        print("PASS resolved hidden path is rejected through a junction alias")

    gzip_source = Path(directory) / "gzip-alias-mod"
    gzip_payload = gzip_source / "payload"
    gzip_payload.mkdir(parents=True)
    (gzip_payload / "asteroid-counts.json.gz").write_bytes(b"not the reviewed manifest")
    gzip_alias = gzip_source / "data"
    gzip_junction = subprocess.run(
        ["cmd.exe", "/c", "mklink", "/J", str(gzip_alias), str(gzip_payload)],
        capture_output=True,
    )
    if gzip_junction.returncode != 0:
        print("SKIP gzip junction alias check (junction creation unavailable)")
    else:
        try:
            builder.validate_package_file(gzip_source, gzip_alias / "asteroid-counts.json.gz")
        except ValueError as error:
            assert "Unexpected package file" in str(error)
        else:
            raise AssertionError("gzip exception accepted a different resolved path")
        print("PASS gzip exception requires the reviewed logical and resolved path")

    junction_source = Path(directory) / "junction-repository" / "mods" / "junction-probe"
    external = Path(directory) / "external-runtime"
    external.mkdir(parents=True)
    (external / "simulation-capability.json").write_text("{}", encoding="utf-8")
    junction_source.mkdir(parents=True)
    manifest = {
        "schemaVersion": 3,
        "id": "junction-probe",
        "version": "0.0.1",
        "updates": {
            "provider": "github",
            "repository": "klimesrenz/evejs-mods",
            "asset": "JunctionProbe-{version}.zip",
            "channel": "stable",
            "tagPrefix": "junction-probe-v",
            "preserveFiles": [],
        },
    }
    (junction_source / "evejs-launcher.mod.json").write_text(json.dumps(manifest), encoding="utf-8")
    junction = junction_source / "lib"
    created = subprocess.run(
        ["cmd.exe", "/c", "mklink", "/J", str(junction), str(external)],
        capture_output=True,
    )
    if created.returncode != 0:
        print("SKIP junction build check (junction creation unavailable)")
    else:
        escaped = junction / "simulation-capability.json"
        try:
            builder.validate_package_file(junction_source, escaped)
        except ValueError as error:
            assert "escapes source root" in str(error)
        else:
            raise AssertionError("junction escape was accepted by path validation")
        original_root = builder.ROOT
        builder.ROOT = junction_source.parents[1]
        try:
            try:
                builder.build(
                    "junction-probe",
                    "JunctionProbe-{version}.zip",
                    "junction-probe-v",
                    "junction-probe",
                )
            except ValueError as error:
                assert "escapes source root" in str(error)
            else:
                raise AssertionError("junction escape was included by the real builder")
        finally:
            builder.ROOT = original_root
        print("PASS real builder rejects a Windows junction escape")

print("PASS build_release rejects case variants, runtime data and hidden nesting")
