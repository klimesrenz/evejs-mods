import importlib.util
import hashlib
import pathlib
import struct
import tempfile
import unittest


MODULE_PATH = pathlib.Path(__file__).parents[2] / "tools" / "extract_tq_asteroid_manifest.py"
SPEC = importlib.util.spec_from_file_location("extract_tq_manifest", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class FsdAsteroidCountDecoderTests(unittest.TestCase):
    def test_decodes_nested_integer_dictionary(self):
        belts = {
            40000003: {1224: 2, 1230: 1},
            40000006: {1228: 3},
        }
        payload = MODULE._encode_fixture_for_test(belts)

        self.assertEqual(MODULE.decode_asteroid_counts(payload), belts)

    def test_rejects_truncated_footer(self):
        payload = MODULE._encode_fixture_for_test({40000003: {1230: 1}})

        with self.assertRaisesRegex(ValueError, "footer"):
            MODULE.decode_asteroid_counts(payload[:-3])

    def test_rejects_corrupted_nested_headers(self):
        payload = bytearray(MODULE._encode_fixture_for_test({40000003: {1230: 1}}))
        schema_size = struct.unpack_from("<I", payload, 0)[0]
        data_start = 4 + schema_size
        struct.pack_into("<I", payload, data_start + 4, 0xCAFEBABE)

        with self.assertRaisesRegex(ValueError, "nested data size header"):
            MODULE.decode_asteroid_counts(bytes(payload))

        payload = bytearray(MODULE._encode_fixture_for_test({40000003: {1230: 1}}))
        struct.pack_into("<I", payload, data_start, 0xDEADBEEF)
        with self.assertRaisesRegex(ValueError, "nested lookup header"):
            MODULE.decode_asteroid_counts(bytes(payload))

    def test_rejects_duplicate_nested_value_offsets(self):
        payload = bytearray(MODULE._encode_fixture_for_test({40000003: {1228: 2, 1230: 1}}))
        schema_size = struct.unpack_from("<I", payload, 0)[0]
        data_start = 4 + schema_size
        nested_footer_start = data_start + 12 + (4 * 2)
        first_offset = struct.unpack_from("<I", payload, nested_footer_start + 4)[0]
        struct.pack_into("<I", payload, nested_footer_start + 12, first_offset)

        with self.assertRaisesRegex(ValueError, "duplicate value offset"):
            MODULE.decode_asteroid_counts(bytes(payload))

    def test_manifest_embeds_authoritative_provenance(self):
        payload = MODULE._encode_fixture_for_test({40000003: {1230: 1}})
        manifest = MODULE.build_manifest(
            payload,
            3632936,
            pathlib.Path("resource.bin"),
            b"official descriptor",
            b"official index",
            "res:/staticdata/asteroidcountbytypeidbeltid.static,resource.bin,md5,1,1",
        )

        self.assertEqual(
            manifest["source"]["buildDescriptor"],
            "https://binaries.eveonline.com/eveonline_3632936.txt",
        )
        self.assertEqual(
            manifest["source"]["buildDescriptorSha256"],
            hashlib.sha256(b"official descriptor").hexdigest(),
        )
        self.assertEqual(
            manifest["source"]["resourceIndexSha256"],
            hashlib.sha256(b"official index").hexdigest(),
        )

    def test_resolves_resource_from_index(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            tq = root / "tq"
            resources = root / "ResFiles"
            tq.mkdir()
            target = resources / "51" / "resource.bin"
            target.parent.mkdir(parents=True)
            target.write_bytes(b"fixture")
            digest = hashlib.md5(b"fixture").hexdigest()
            (tq / "resfileindex.txt").write_text(
                f"res:/staticdata/asteroidcountbytypeidbeltid.static,51/resource.bin,{digest},7,7\n",
                encoding="utf-8",
            )

            resolved, verified_raw, index_raw, resource_entry = MODULE.load_verified_client_resource(tq)

            self.assertEqual(resolved, target)
            self.assertEqual(verified_raw, b"fixture")
            self.assertEqual(hashlib.sha256(index_raw).hexdigest(), hashlib.sha256(
                (tq / "resfileindex.txt").read_bytes()
            ).hexdigest())
            self.assertEqual(resource_entry.split(",")[0], MODULE.RESOURCE_PATH)

            target.write_bytes(b"changed after verification")
            self.assertEqual(verified_raw, b"fixture")
            target.write_bytes(b"fixture")

            (tq / "resfileindex.txt").write_text(
                "res:/staticdata/asteroidcountbytypeidbeltid.static,51/resource.bin,"
                "00000000000000000000000000000000,7,7\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "MD5 mismatch"):
                MODULE.load_verified_client_resource(tq)


if __name__ == "__main__":
    unittest.main()
