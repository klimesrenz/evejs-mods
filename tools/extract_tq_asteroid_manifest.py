#!/usr/bin/env python3
"""Extract the TQ per-belt asteroid count table from an EVE client."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import pathlib
import pickle
import re
import struct
from typing import Dict


RESOURCE_PATH = "res:/staticdata/asteroidcountbytypeidbeltid.static"
SCHEMA_VERSION = 1
ITEM_ID_STRIDE = 512


def _u32(buffer: bytes, offset: int) -> int:
    if offset < 0 or offset + 4 > len(buffer):
        raise ValueError(f"truncated footer or integer at offset {offset}")
    return struct.unpack_from("<I", buffer, offset)[0]


def _payload_from_static_file(raw: bytes) -> bytes:
    if len(raw) < 8:
        raise ValueError("static file is too short for the schema header")
    schema_size = _u32(raw, 0)
    payload_offset = 4 + schema_size
    if payload_offset >= len(raw):
        raise ValueError("schema header exceeds static file size")
    return raw[payload_offset:]


def decode_asteroid_counts(raw: bytes) -> Dict[int, Dict[int, int]]:
    """Decode the nested int→(int→int) FSD dictionary used by this resource."""
    payload = _payload_from_static_file(raw)
    if len(payload) < 16:
        raise ValueError("payload is too short for the outer footer")

    outer_footer_size = _u32(payload, len(payload) - 4)
    if outer_footer_size < 4 or (outer_footer_size - 4) % 12 != 0:
        raise ValueError("invalid outer footer size")
    outer_footer_start = len(payload) - outer_footer_size
    if outer_footer_start < 8:
        raise ValueError("outer footer exceeds payload size")

    belt_count = (outer_footer_size - 4) // 12
    if _u32(payload, outer_footer_start - 4) != belt_count:
        raise ValueError("outer footer count does not match its size")
    outer_entries = []
    seen_belt_ids = set()
    for index in range(belt_count):
        entry_offset = outer_footer_start + index * 12
        belt_id, value_offset, value_size = struct.unpack_from("<III", payload, entry_offset)
        if belt_id <= 0 or belt_id in seen_belt_ids:
            raise ValueError(f"invalid or duplicate belt ID {belt_id}")
        seen_belt_ids.add(belt_id)
        if value_size < 24 or (value_size - 12) % 12 != 0:
            raise ValueError(f"belt {belt_id} has invalid nested dictionary size {value_size}")
        value_end = value_offset + value_size
        if value_end > outer_footer_start:
            raise ValueError(f"belt {belt_id} value overlaps the outer footer")
        outer_entries.append((belt_id, value_offset, value_size))

    expected_offset = 0
    for belt_id, value_offset, value_size in sorted(outer_entries, key=lambda entry: entry[1]):
        if value_offset != expected_offset:
            raise ValueError(
                f"belt {belt_id} value range is overlapping or non-contiguous at {value_offset}"
            )
        expected_offset += value_size
    if expected_offset != outer_footer_start - 8:
        raise ValueError("nested value ranges do not terminate at the outer footer")

    result: Dict[int, Dict[int, int]] = {}
    for belt_id, value_offset, value_size in outer_entries:
        type_count = (value_size - 12) // 12
        # This first word is lookup-index metadata, not the local footer byte
        # size: retained TQ resources use different 12+8n values for equal
        # dictionaries. Validate its encoding here; load_verified_client_resource()
        # authenticates every production input against resfileindex.txt MD5.
        lookup_header = _u32(payload, value_offset)
        invalid_lookup_header = (
            lookup_header != len(payload) - 4
            if value_offset == 0
            else (
                lookup_header < 12
                or lookup_header > len(payload) - 4
                or (lookup_header - 12) % 8 != 0
            )
        )
        if invalid_lookup_header:
            raise ValueError(f"belt {belt_id} has invalid nested lookup header")
        if _u32(payload, value_offset + 4) != value_size - 4:
            raise ValueError(f"belt {belt_id} has invalid nested data size header")
        count_marker_offset = value_offset + 8 + (4 * type_count)
        if _u32(payload, count_marker_offset) != type_count:
            raise ValueError(f"belt {belt_id} nested footer count does not match its size")
        nested_footer_start = value_offset + 12 + (4 * type_count)
        values_start = value_offset + 8
        belt_rows: Dict[int, int] = {}
        seen_value_offsets = set()
        for type_index in range(type_count):
            type_id, relative_value_offset = struct.unpack_from(
                "<II", payload, nested_footer_start + type_index * 8
            )
            if relative_value_offset % 4 != 0 or relative_value_offset >= type_count * 4:
                raise ValueError(f"belt {belt_id} has invalid value offset for type {type_id}")
            if relative_value_offset in seen_value_offsets:
                raise ValueError(f"belt {belt_id} has duplicate value offset {relative_value_offset}")
            seen_value_offsets.add(relative_value_offset)
            if type_id <= 0 or type_id in belt_rows:
                raise ValueError(f"belt {belt_id} has invalid or duplicate type ID {type_id}")
            count = _u32(payload, values_start + relative_value_offset)
            if count <= 0:
                raise ValueError(f"belt {belt_id} type {type_id} has non-positive count")
            belt_rows[type_id] = count
        result[belt_id] = belt_rows
    return result


def _encode_fixture_for_test(belts: Dict[int, Dict[int, int]]) -> bytes:
    values = bytearray()
    outer_entries = []
    for belt_id, rows in sorted(belts.items()):
        sorted_rows = sorted(rows.items())
        nested_size = (12 * len(sorted_rows)) + 12
        nested = bytearray(struct.pack(
            "<II",
            len(sorted_rows) * 8 + 4,
            nested_size - 4,
        ))
        for _type_id, count in sorted_rows:
            nested.extend(struct.pack("<I", count))
        nested.extend(struct.pack("<I", len(sorted_rows)))
        for value_index, (type_id, _count) in enumerate(sorted_rows):
            nested.extend(struct.pack("<II", type_id, value_index * 4))
        outer_entries.append((belt_id, len(values), len(nested)))
        values.extend(nested)
    footer = bytearray()
    for entry in outer_entries:
        footer.extend(struct.pack("<III", *entry))
    footer.extend(struct.pack("<I", len(footer) + 4))
    outer_header = struct.pack("<II", 0, len(outer_entries))
    payload = bytearray(values + outer_header + footer)
    if payload:
        struct.pack_into("<I", payload, 0, len(payload) - 4)
    schema = pickle.dumps({"type": "dict", "buildIndex": True}, protocol=0)
    return struct.pack("<I", len(schema)) + schema + bytes(payload)


def load_verified_client_resource(
    tq_root: pathlib.Path,
    resource_index: pathlib.Path | None = None,
) -> tuple[pathlib.Path, bytes, bytes, str]:
    tq_root = pathlib.Path(tq_root).resolve()
    index_path = pathlib.Path(resource_index).resolve() if resource_index else tq_root / "resfileindex.txt"
    if not index_path.is_file():
        raise FileNotFoundError(f"client resource index not found: {index_path}")
    index_raw = index_path.read_bytes()
    resource_record = None
    resource_entry = None
    for raw_line in index_raw.decode("utf-8").splitlines():
        columns = raw_line.split(",")
        if len(columns) >= 4 and columns[0].lower() == RESOURCE_PATH:
            resource_record = columns
            resource_entry = raw_line
            break
    if not resource_record or resource_entry is None:
        raise FileNotFoundError(f"{RESOURCE_PATH} is absent from {index_path}")
    hashed_path = resource_record[1]
    expected_md5 = resource_record[2].lower()
    if not re.fullmatch(r"[0-9a-f]{32}", expected_md5):
        raise ValueError(f"invalid MD5 in client resource index for {RESOURCE_PATH}")
    try:
        expected_size = int(resource_record[3])
    except ValueError as error:
        raise ValueError(f"invalid size in client resource index for {RESOURCE_PATH}") from error
    resources_root = (tq_root.parent / "ResFiles").resolve()
    resource_path = (resources_root / pathlib.PurePosixPath(hashed_path)).resolve()
    try:
        resource_path.relative_to(resources_root)
    except ValueError as error:
        raise ValueError(f"resource index path escapes ResFiles: {hashed_path}") from error
    if not resource_path.is_file():
        raise FileNotFoundError(f"client resource file not found: {resource_path}")
    raw = resource_path.read_bytes()
    if len(raw) != expected_size:
        raise ValueError(
            f"client resource size mismatch: expected {expected_size}, got {len(raw)}"
        )
    actual_md5 = hashlib.md5(raw).hexdigest()
    if actual_md5 != expected_md5:
        raise ValueError(
            f"client resource MD5 mismatch: expected {expected_md5}, got {actual_md5}"
        )
    return resource_path, raw, index_raw, resource_entry


def build_manifest(
    raw: bytes,
    client_build: int,
    resource_file: pathlib.Path,
    build_descriptor: bytes,
    resource_index: bytes,
    resource_index_entry: str,
) -> dict:
    belts = decode_asteroid_counts(raw)
    totals = {belt_id: sum(rows.values()) for belt_id, rows in belts.items()}
    maximum_belt_id = max(totals, key=totals.get)
    maximum_belt_count = totals[maximum_belt_id]
    if maximum_belt_count >= ITEM_ID_STRIDE:
        raise ValueError(
            f"maximum TQ belt count {maximum_belt_count} exceeds EveJS item-ID stride {ITEM_ID_STRIDE}"
        )
    return {
        "schemaVersion": SCHEMA_VERSION,
        "source": {
            "clientBuild": int(client_build),
            "resourcePath": RESOURCE_PATH,
            "resourceFile": resource_file.name,
            "sha256": hashlib.sha256(raw).hexdigest(),
            "buildDescriptor": (
                f"https://binaries.eveonline.com/eveonline_{client_build}.txt"
            ),
            "buildDescriptorSha256": hashlib.sha256(build_descriptor).hexdigest(),
            "resourceIndexSha256": hashlib.sha256(resource_index).hexdigest(),
            "resourceIndexEntry": resource_index_entry,
        },
        "stats": {
            "beltCount": len(belts),
            "asteroidCount": sum(totals.values()),
            "typeCount": sum(len(rows) for rows in belts.values()),
            "maximumBeltCount": maximum_belt_count,
            "maximumBeltID": maximum_belt_id,
        },
        "belts": {
            str(belt_id): [[type_id, count] for type_id, count in sorted(rows.items())]
            for belt_id, rows in sorted(belts.items())
        },
    }


def write_manifest(manifest: dict, output_path: pathlib.Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with gzip.GzipFile(filename="", mode="wb", fileobj=output_path.open("wb"), mtime=0) as archive:
        archive.write(encoded)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client-tq", required=True, type=pathlib.Path)
    parser.add_argument("--client-build", required=True, type=int)
    parser.add_argument("--build-descriptor", required=True, type=pathlib.Path)
    parser.add_argument("--resource-index", required=True, type=pathlib.Path)
    parser.add_argument("--output", required=True, type=pathlib.Path)
    arguments = parser.parse_args()

    expected_descriptor_name = f"eveonline_{arguments.client_build}.txt"
    if arguments.build_descriptor.name != expected_descriptor_name:
        raise ValueError(
            f"build descriptor must be named {expected_descriptor_name}"
        )
    descriptor_raw = arguments.build_descriptor.read_bytes()
    resource_path, raw, index_raw, resource_entry = load_verified_client_resource(
        arguments.client_tq,
        arguments.resource_index,
    )
    manifest = build_manifest(
        raw,
        arguments.client_build,
        resource_path,
        descriptor_raw,
        index_raw,
        resource_entry,
    )
    write_manifest(manifest, arguments.output)
    asteroid_count = sum(
        count for rows in manifest["belts"].values() for _type_id, count in rows
    )
    maximum = max(sum(count for _type_id, count in rows) for rows in manifest["belts"].values())
    print(json.dumps({
        "output": str(arguments.output.resolve()),
        "clientBuild": arguments.client_build,
        "beltCount": len(manifest["belts"]),
        "asteroidCount": asteroid_count,
        "maximumBeltCount": maximum,
        "sha256": manifest["source"]["sha256"],
    }, indent=2))


if __name__ == "__main__":
    main()
