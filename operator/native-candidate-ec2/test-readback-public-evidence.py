"""Offline fixed-path readback tests with synthetic public archive fixtures.
No EC2, network, credential, wallet or financial data is accessed.
"""
import base64
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import random
import tarfile
import tempfile
import unittest
import time
from unittest.mock import patch

PATH = pathlib.Path(__file__).with_name("readback-public-evidence.py")
spec = importlib.util.spec_from_file_location("public_evidence_readback", PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
RUN = "40633990901"
ATTEMPT = "1"


@contextlib.contextmanager
def fixture(payload=b"SYNTHETIC public candidate evidence only\n"):
    with tempfile.TemporaryDirectory(prefix="poe-OFFLINE-public-evidence-") as name:
        base = pathlib.Path(name)
        run = base / ("poe-native-candidates-" + RUN + "-" + ATTEMPT)
        export = run / "export"
        export.mkdir(parents=True, mode=0o700)
        run.chmod(0o700)
        archive = export / module.ARCHIVE
        with tarfile.open(archive, "w:gz", compresslevel=1) as out:
            info = tarfile.TarInfo("SYNTHETIC-public.txt")
            info.size = len(payload)
            info.mtime = 0
            out.addfile(info, io.BytesIO(payload))
        archive.chmod(0o600)
        raw = archive.read_bytes()
        manifest = {"schemaVersion": 1, "classification": "candidate-only-public-evidence", "complete": True, "format": "tar+gzip", "researchProfile": module.PROFILE, "githubRunId": RUN, "githubRunAttempt": ATTEMPT, "accountId": module.ACCOUNT_ID, "inceptionAt": module.INCEPTION_AT, "archive": {"file": module.ARCHIVE, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "stat": module.stat_identity(archive.stat())}, "credentialsIncluded": False, "financialFilesIncluded": False}
        path = export / module.MANIFEST
        def write_manifest():
            path.write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
            path.chmod(0o600)
        write_manifest()
        fd = os.open(base, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            yield {"base": base, "run": run, "export": export, "archive": archive, "manifest_path": path, "manifest": manifest, "raw": raw, "write_manifest": write_manifest, "base_fd": fd, "uid": os.getuid()}
        finally:
            os.close(fd)


def stream(f, offset="0", length="4194304", output=None):
    output = output if output is not None else io.StringIO()
    result = module.stream_from_base_fd(f["base_fd"], f["uid"], RUN, ATTEMPT, offset, length, output)
    return result, output, [json.loads(line) for line in output.getvalue().splitlines()]


class ReadbackProtocol(unittest.TestCase):
    def test_complete_chunk_reassembles_exact_bytes_with_explicit_partial_hash_scope(self):
        with fixture() as f:
            result, output, rows = stream(f)
            self.assertEqual(rows[0]["kind"], "header")
            self.assertEqual(rows[0]["chunk"]["actualLength"], len(f["raw"]))
            self.assertEqual(rows[0]["githubRunId"], RUN)
            data = b"".join(base64.b64decode(r["base64"], validate=True) for r in rows if r["kind"] == "data")
            self.assertEqual(data, f["raw"])
            self.assertEqual(rows[-1]["chunkSha256"], hashlib.sha256(data).hexdigest())
            self.assertEqual(rows[-1]["archiveSha256"], f["manifest"]["archive"]["sha256"])
            self.assertTrue(rows[-1]["complete"])
            self.assertFalse(rows[-1]["archiveWholeHashVerifiedByThisCall"])
            self.assertEqual(result["bytes"], len(data))
            self.assertNotIn(str(f["base"]), output.getvalue())

    def test_offset_eof_and_last_chunk_are_bounded_and_do_not_claim_whole_archive_validation(self):
        with fixture() as f:
            start = len(f["raw"]) - 11
            _, _, rows = stream(f, str(start), "64")
            self.assertEqual(rows[0]["chunk"]["requestedLength"], 64)
            self.assertEqual(rows[-1]["bytes"], 11)
            self.assertEqual(base64.b64decode(rows[1]["base64"]), f["raw"][start:])
            _, _, eof = stream(f, str(len(f["raw"])), "1")
            self.assertEqual([r["kind"] for r in eof], ["header", "footer"])
            self.assertEqual(eof[-1]["bytes"], 0)
            self.assertEqual(eof[-1]["chunkSha256"], hashlib.sha256(b"").hexdigest())

    def test_maximum_four_mib_call_reads_only_four_mib_and_log_records_stay_below64k(self):
        payload = random.Random(7).randbytes(5 * module.MIB)
        with fixture(payload) as f:
            actual = os.pread
            read_bytes = []
            def counted(fd, length, offset):
                value = actual(fd, length, offset)
                read_bytes.append(len(value))
                return value
            with patch.object(module.os, "pread", side_effect=counted):
                _, output, rows = stream(f)
            self.assertEqual(sum(read_bytes), 4 * module.MIB)
            self.assertEqual(rows[-1]["bytes"], 4 * module.MIB)
            self.assertTrue(all(size <= module.SOURCE_BLOCK_BYTES for size in read_bytes))
            self.assertTrue(all(len((line + "\n").encode("ascii")) <= 64 * 1024 for line in output.getvalue().splitlines()))
            data = b"".join(base64.b64decode(r["base64"]) for r in rows if r["kind"] == "data")
            self.assertEqual(data, f["raw"][:4 * module.MIB])
            self.assertEqual(rows[-1]["chunkSha256"], hashlib.sha256(data).hexdigest())


class FixedAccessBoundary(unittest.TestCase):
    def test_numeric_bounds_and_paths_fail_before_fixed_directory_access(self):
        cases = [("../secret", ATTEMPT, "0", "1"), ("01", ATTEMPT, "0", "1"), (RUN, "0", "0", "1"), (RUN, ATTEMPT, "-1", "1"), (RUN, ATTEMPT, "1e3", "1"), (RUN, ATTEMPT, "0", str(4 * module.MIB + 1)), (RUN, ATTEMPT, str(256 * module.MIB + 1), "1"), (RUN, ATTEMPT, "0", "0"), ("\uff11", ATTEMPT, "0", "1")]
        with patch.object(module, "open_fixed_base", side_effect=AssertionError("No filesystem access is authorized for invalid arguments")):
            for args in cases:
                with self.subTest(args=args), self.assertRaises(module.EvidenceReadbackError):
                    module.readback_public_evidence(*args, io.StringIO())

    def test_cli_has_no_caller_path_or_environment_override_and_does_not_echo_rejected_values(self):
        output = io.StringIO()
        args = ["--run-id", RUN, "--attempt", ATTEMPT, "--offset", "0", "--length", "1", "--base", "/PRIVATE/DO_NOT_PRINT"]
        self.assertEqual(module.main(args, output), 1)
        self.assertNotIn("PRIVATE", output.getvalue())
        self.assertEqual(json.loads(output.getvalue())["code"], "READBACK_ARGUMENTS_INVALID")
        output = io.StringIO()
        with patch.object(module.os, "getuid", return_value=0):
            self.assertEqual(module.main(args[:8], output), 1)
        self.assertEqual(json.loads(output.getvalue())["code"], "READBACK_EXPECTED_NONROOT_UID_REQUIRED")

    def test_symlinked_manifest_archive_and_run_directory_are_never_followed(self):
        for name in ["manifest_path", "archive", "run"]:
            with self.subTest(name=name), fixture() as f:
                path = f[name]
                target = path.with_name(path.name + ".fixture-original")
                path.rename(target)
                path.symlink_to(target, target_is_directory=name == "run")
                output = io.StringIO()
                with self.assertRaises(OSError):
                    stream(f, output=output)
                self.assertEqual(output.getvalue(), "")

    def test_private_owner_single_link_and_directory_constraints_fail_closed(self):
        for name in ["base", "run", "export", "manifest_path", "archive"]:
            with self.subTest(name=name), fixture() as f:
                f[name].chmod(0o755 if f[name].is_dir() else 0o644)
                with self.assertRaises(module.EvidenceReadbackError):
                    stream(f)
        for name in ["manifest_path", "archive"]:
            with self.subTest(hardlink=name), fixture() as f:
                os.link(f[name], f[name].with_name(f[name].name + ".fixture-link"))
                with self.assertRaises(module.EvidenceReadbackError):
                    stream(f)
        with fixture() as f, self.assertRaises(module.EvidenceReadbackError):
            module.stream_from_base_fd(f["base_fd"], f["uid"] + 1, RUN, ATTEMPT, "0", "1", io.StringIO())


class ManifestAndIntegrity(unittest.TestCase):
    def test_manifest_public_profile_binding_flags_and_exact_filename_are_mandatory(self):
        patches = [("complete", False), ("classification", "other"), ("format", "raw"), ("researchProfile", "legacy"), ("githubRunId", "1"), ("githubRunAttempt", 1), ("accountId", "other"), ("inceptionAt", 1), ("credentialsIncluded", True), ("financialFilesIncluded", True)]
        for key, value in patches:
            with self.subTest(key=key), fixture() as f:
                f["manifest"][key] = value
                f["write_manifest"]()
                with self.assertRaises(module.EvidenceReadbackError):
                    stream(f)

    def test_closed_public_creator_extras_are_accepted_but_arbitrary_metadata_is_not(self):
        with fixture() as f:
            f["manifest"].update({"source": {"commit": "f" * 40, "sha256": "e" * 64}, "runtimeOutcome": {"classification": "fatal-source-stop"}, "uncompressedSelectedBytes": 1000, "selectedEvidenceBytes": 500, "indexSha256": "a" * 64, "rawSelectedEvidenceRetained": True, "compressionLevel": 6, "costMeaning": "SYNTHETIC offline fixture only", "elapsedMs": 10, "cpuMs": 5})
            f["write_manifest"]()
            _, _, rows = stream(f)
            self.assertTrue(rows[-1]["complete"])
            self.assertNotIn("runtimeOutcome", rows[0], "readback does not relabel source failure as success")
            f["manifest"]["arbitraryPrivateField"] = "DO_NOT_PRINT"
            f["write_manifest"]()
            with self.assertRaisesRegex(module.EvidenceReadbackError, "MANIFEST_FIELDS"):
                stream(f)
        for patch_archive in [{"file": "../PRIVATE"}, {"bytes": 256 * module.MIB + 1}, {"sha256": "not-a-hash"}, {"stat": {"device": 1}}]:
            with self.subTest(archive=patch_archive), fixture() as f:
                f["manifest"]["archive"].update(patch_archive)
                f["write_manifest"]()
                with self.assertRaises(module.EvidenceReadbackError):
                    stream(f)

    def test_stale_manifest_stats_and_duplicate_or_oversized_metadata_are_refused(self):
        with fixture() as f:
            f["manifest"]["archive"]["stat"]["mtimeNs"] += 1
            f["write_manifest"]()
            with self.assertRaisesRegex(module.EvidenceReadbackError, "STAT_MISMATCH"):
                stream(f)
        with fixture() as f:
            text = f["manifest_path"].read_text()
            f["manifest_path"].write_text('{"schemaVersion":1,' + text[1:])
            with self.assertRaisesRegex(module.EvidenceReadbackError, "DUPLICATE"):
                stream(f)
        with fixture() as f:
            f["manifest_path"].write_bytes(b"x" * (module.MAXIMUM_MANIFEST_BYTES + 1))
            with self.assertRaises(module.EvidenceReadbackError):
                stream(f)

    def test_archive_or_manifest_mutation_during_read_never_emits_successful_footer(self):
        for target in ["archive", "manifest_path"]:
            with self.subTest(target=target), fixture() as f:
                original = os.pread
                changed = False
                def mutate(fd, length, offset):
                    nonlocal changed
                    block = original(fd, length, offset)
                    if not changed:
                        changed = True
                        with f[target].open("ab") as out:
                            out.write(b"\n")
                    return block
                output = io.StringIO()
                with patch.object(module.os, "pread", side_effect=mutate), self.assertRaises(module.EvidenceReadbackError):
                    stream(f, output=output)
                rows = [json.loads(line) for line in output.getvalue().splitlines()]
                self.assertFalse(any(row.get("kind") == "footer" and row.get("complete") for row in rows))

    def test_out_of_file_offset_has_no_header_and_rejected_descriptors_do_not_leak(self):
        with fixture() as f:
            before = len(os.listdir("/proc/self/fd"))
            for _ in range(10):
                output = io.StringIO()
                with self.assertRaisesRegex(module.EvidenceReadbackError, "OFFSET_AFTER_EOF"):
                    stream(f, str(len(f["raw"]) + 1), "1", output)
                self.assertEqual(output.getvalue(), "")
            self.assertEqual(len(os.listdir("/proc/self/fd")), before)


class ActualProducerConsumerComposition(unittest.TestCase):
    def test_actual_current_archiver_output_is_decoded_and_read_by_actual_reader(self):
        creator_path = PATH.with_name("run-bounded.py")
        creator_spec = importlib.util.spec_from_file_location("public_archive_creator_fixture", creator_path)
        creator = importlib.util.module_from_spec(creator_spec)
        creator_spec.loader.exec_module(creator)
        with tempfile.TemporaryDirectory(prefix="poe-OFFLINE-actual-public-archive-") as name:
            base = pathlib.Path(name)
            root = base / ("poe-native-candidates-" + RUN + "-" + ATTEMPT)
            (root / "run/events").mkdir(parents=True, mode=0o700)
            root.chmod(0o700)
            (root / "run").chmod(0o700)
            original_bytes = b'{"kind":"SYNTHETIC-offline-evidence","financialWriter":false}\n'
            evidence = root / "run/events/events-001.ndjson"
            evidence.write_bytes(original_bytes)
            evidence.chmod(0o600)
            limits = creator.host_profile(creator.TWO_HOUR_PROFILE)
            creator.export_artifact(root, "a" * 64, limits)
            original_regular = creator.regular
            # Only the fixture UID differs from the real host's fixed UID994.
            def fixture_regular(path, maximum, owner=None, private=False):
                return original_regular(path, maximum, os.getuid() if owner == 994 else owner, private)
            creator.regular = fixture_regular
            try:
                outcome = {"accountId": module.ACCOUNT_ID, "inceptionAt": module.INCEPTION_AT, "source": {"commit": "f" * 40, "sha256": "e" * 64}, "runtimeOutcome": {"classification": "fatal-source-stop", "mechanicallyCompleted": False, "failureReason": "SYNTHETIC_OFFLINE_FAILURE_RETAINED"}}
                created = creator.archive_public_evidence(root, limits, time.monotonic() + 10, creator.TWO_HOUR_PROFILE, outcome, RUN, ATTEMPT)
            finally:
                creator.regular = original_regular
            self.assertTrue(created["complete"])
            self.assertEqual(created["runtimeOutcome"]["classification"], "fatal-source-stop")
            source = (root / "export/selected-evidence.tar.gz").read_bytes()
            self.assertEqual(hashlib.sha256(source).hexdigest(), created["archive"]["sha256"])
            raw_manifest = (root / "export/archive.json").read_bytes()
            self.assertEqual(module.decode_manifest(raw_manifest, RUN, ATTEMPT), created)
            base_fd = os.open(base, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                output = io.StringIO()
                module.stream_from_base_fd(base_fd, os.getuid(), RUN, ATTEMPT, "0", "4194304", output)
            finally:
                os.close(base_fd)
            rows = [json.loads(line) for line in output.getvalue().splitlines()]
            returned = b"".join(base64.b64decode(row["base64"], validate=True) for row in rows if row["kind"] == "data")
            self.assertEqual(returned, source)
            self.assertEqual(rows[-1]["chunkSha256"], hashlib.sha256(source).hexdigest())
            with tarfile.open(fileobj=io.BytesIO(returned), mode="r:gz") as opened:
                self.assertEqual(opened.extractfile("run/events/events-001.ndjson").read(), original_bytes)
            self.assertEqual(evidence.read_bytes(), original_bytes, "raw evidence is preserved after compression/readback")


if __name__ == "__main__":
    unittest.main()
