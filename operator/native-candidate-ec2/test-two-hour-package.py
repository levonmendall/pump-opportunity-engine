"""Synthetic offline packaging/storage tests, not provider or EC2 capacity proof."""
import hashlib
import importlib.util
import json
import pathlib
import os
import types
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch

PATH = pathlib.Path(__file__).with_name("run-bounded.py")
spec = importlib.util.spec_from_file_location("bounded_two_hour", PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
MIB = 1024 * 1024


class Profiles(unittest.TestCase):
    def test_default_is_unchanged_and_extended_choices_are_closed_and_independent(self):
        old = module.host_profile()
        self.assertEqual([old[k] for k in ["durationSeconds", "outerSeconds", "runnerTimeoutSeconds", "runnerCpuSeconds", "temporaryMiB", "artifactMiB", "evidenceMiB", "minimumAvailableDiskMiB"]], [900, 1020, 915, 240, 256, 192, 128, 1024])
        extended = module.host_profile(module.TWO_HOUR_PROFILE)
        self.assertEqual([extended[k] for k in ["durationSeconds", "outerSeconds", "runnerTimeoutSeconds", "runnerCpuSeconds", "temporaryMiB", "artifactMiB", "evidenceMiB", "minimumAvailableDiskMiB"]], [7200, 7320, 7215, 1920, 1536, 1280, 1024, 2048])
        self.assertEqual(extended["runnerCpuSeconds"] + 5, 1925)
        self.assertEqual(extended["workflowTimeoutMinutes"], 125)
        self.assertEqual(extended["maximumBaselinePaths"], 192)
        self.assertEqual(extended["maximumComponentBookBytes"], 512 * 1024)
        self.assertEqual(extended["maximumBaselineBytes"], 32 * MIB)
        self.assertEqual(module.observation_policy(), "observation-age-v1")
        self.assertEqual(module.observation_policy(module.STUDY_OBSERVATION_POLICY), module.STUDY_OBSERVATION_POLICY)
        self.assertEqual(module.data_contract(), "confirmed-program-events-v2")
        for function, bad in [(module.host_profile, "7200"), (module.host_profile, "unlimited"), (module.observation_policy, "48-hour"), (module.data_contract, "unreviewed")]:
            with self.subTest(bad=bad):
                with self.assertRaises(RuntimeError):
                    function(bad)
        extended["runnerCpuSeconds"] = 1
        self.assertEqual(module.host_profile(module.TWO_HOUR_PROFILE)["runnerCpuSeconds"], 1920)

    def test90_profile_changes_only_unit_ceiling_and_both_long_choices_remain_durable(self):
        old = module.host_profile(module.TWO_HOUR_PROFILE)
        selected = module.host_profile(module.TWO_HOUR_90_PROFILE)
        self.assertEqual(selected["maximumUnits"], 11500)
        self.assertEqual(old["maximumUnits"], 7500)
        self.assertEqual({**selected, "maximumUnits": old["maximumUnits"]}, old)
        self.assertEqual(module.LONG_PROFILES, frozenset([module.TWO_HOUR_PROFILE, module.TWO_HOUR_90_PROFILE]))
        self.assertNotIn(None, module.LONG_PROFILES)
        source = PATH.read_text()
        self.assertIn("if profile in LONG_PROFILES:", source)
        self.assertNotIn("if profile == TWO_HOUR_PROFILE:", source)
        selected["maximumUnits"] = 1
        self.assertEqual(module.host_profile(module.TWO_HOUR_90_PROFILE)["maximumUnits"], 11500)
        for invalid in ["candidate-native-two-hour-90-research-v2", "candidate-native-two-hour-120-research-v1", 90, []]:
            with self.assertRaisesRegex(RuntimeError, "UNKNOWN_HOST_RESEARCH_PROFILE"):
                module.host_profile(invalid)

    def test_two_hour_runtime_completion_is_not_a_candidate_window_pass(self):
        source = {"running": False, "startedAt": 1000000, "generatedAt": 8190010, "elapsedMs": 7190010, "stopRequestedAt": 8190000, "logicalObservationCutoffAt": 8190000, "stopReason": "logical observation cutoff reached; shutdown reserve begins", "engine": {"rpc": {"fatal": None}, "counters": {"auditedWindows": 0, "predictiveAssessments": 0}}}
        good = module.runtime_outcome(source, 7200000)
        self.assertTrue(good["mechanicallyCompleted"])
        self.assertEqual(good["plannedAdmissionDurationMs"], 7190000)
        self.assertEqual(good["candidateWindowEvidence"]["classification"], "no-audited-window-evidence")
        for patch in [{"elapsedMs": 1}, {"elapsedMs": 7200001, "generatedAt": 8200001}, {"stopReason": "NATIVE_RESEARCH_RPC_FATAL"}]:
            self.assertFalse(module.runtime_outcome({**source, **patch}, 7200000)["mechanicallyCompleted"])

    def test_reduced_final_uses_only_explicit_fatal_and_counter_projection(self):
        source = {"engine": None, "usage": {"rpc": {"fatal": "COMPONENT_STORAGE_FAILURE"}}, "funnel": {"usableWindows": 4, "evaluated": 4}, "running": False, "stopReason": "bounded interval completed", "startedAt": 0, "generatedAt": 890000, "elapsedMs": 890000, "logicalObservationCutoffAt": 890000, "stopRequestedAt": 890000}
        result = module.runtime_outcome(source)
        self.assertEqual(result["classification"], "fatal-source-stop")
        self.assertEqual(result["candidateWindowEvidence"]["auditedWindows"], 4)
        self.assertEqual(result["candidateWindowEvidence"]["predictiveAssessments"], 4)
        self.assertIsNone(result["candidateWindowEvidence"]["uniqueEvaluated"])


class CompleteArchives(unittest.TestCase):
    def setUp(self):
        self.owner_checked = module.regular
        # Fixture data belongs to the test UID. Runtime remains hard UID994.
        module.regular = lambda path, maximum, owner=None, private=False: self.owner_checked(path, maximum, None, private)

    def tearDown(self):
        module.regular = self.owner_checked

    def test_explicit_two_hour_export_exceeds_old_cap_without_omitting_any_segment(self):
        with tempfile.TemporaryDirectory(prefix="poe-OFFLINE-long-export-") as directory:
            root = pathlib.Path(directory)
            events = root / "run/events"
            events.mkdir(parents=True)
            content = (b'{"classification":"SYNTHETIC-STORAGE-FIXTURE"}\n' * 200000)[:8 * MIB]
            content += b" " * (8 * MIB - len(content))
            for index in range(25):
                path = events / ("events-" + str(index).zfill(3) + ".ndjson")
                path.write_bytes(content)
                path.chmod(0o600)
            result = module.export_artifact(root, "a" * 64, module.host_profile(module.TWO_HOUR_PROFILE))
            self.assertEqual(result["selectedEvidenceBytes"], 200 * MIB)
            self.assertGreater(result["uncompressedBytes"], 192 * MIB)
            index = json.loads((root / "export/index.json").read_text())
            self.assertEqual(len(index["included"]), 25)
            self.assertEqual(index["omittedSelectedEvidence"], [])
            outcome = {"source": {"commit": "a" * 40, "sha256": "b" * 64}, "accountId": "poe-pilot-8468add6-f916-48cf-a585-6cd008a81360", "inceptionAt": 1793123773252}
            archive = module.archive_public_evidence(root, module.host_profile(module.TWO_HOUR_PROFILE), time.monotonic() + 45, module.TWO_HOUR_PROFILE, outcome, "123", "1")
            self.assertTrue(archive["complete"])
            self.assertEqual(archive["uncompressedSelectedBytes"], 200 * MIB)
            path = root / "export/selected-evidence.tar.gz"
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), archive["archive"]["sha256"])
            with tarfile.open(path, "r:gz") as captured:
                self.assertEqual(len(captured.getmembers()), 26)
                for member in captured.getmembers():
                    if member.name != "index.json":
                        self.assertEqual(hashlib.sha256(captured.extractfile(member).read()).hexdigest(), hashlib.sha256(content).hexdigest())
            self.assertEqual(len(list(events.glob("*.ndjson"))), 25)

    def test_expired_archive_deadline_keeps_raw_and_cannot_create_a_readback_ready_archive(self):
        with tempfile.TemporaryDirectory(prefix="poe-OFFLINE-archive-fail-") as directory:
            root = pathlib.Path(directory)
            (root / "run/events").mkdir(parents=True)
            path = root / "run/events/one.ndjson"
            path.write_text('{"fixture":true}\n')
            path.chmod(0o600)
            module.export_artifact(root, "a" * 64)
            result = module.archive_public_evidence(root, module.host_profile(), time.monotonic() - 1, None, {"source": {}, "accountId": "fixture", "inceptionAt": 1}, "1", "1")
            self.assertFalse(result["complete"])
            self.assertTrue(path.exists())
            self.assertFalse((root / "export/selected-evidence.tar.gz").exists())
            self.assertTrue(result["rawSelectedEvidenceRetained"])

    def test_archive_cpu_and_memory_failures_preserve_selected_files(self):
        for guard in ["cpu", "rss"]:
            with self.subTest(guard=guard), tempfile.TemporaryDirectory(prefix="poe-OFFLINE-archive-resource-") as directory:
                root = pathlib.Path(directory)
                (root / "run/events").mkdir(parents=True)
                path = root / "run/events/one.ndjson"
                path.write_text('{"fixture":true}\n')
                path.chmod(0o600)
                module.export_artifact(root, "a" * 64)
                limits = module.host_profile()
                manager = patch.object(module.time, "process_time", side_effect=[0] + [1000] * 20) if guard == "cpu" else patch.object(module.resource, "getrusage", return_value=types.SimpleNamespace(ru_maxrss=257 * 1024))
                with manager:
                    result = module.archive_public_evidence(root, limits, time.monotonic() + 10, None, {"source": {}, "accountId": "fixture", "inceptionAt": 1}, "1", "1")
                self.assertFalse(result["complete"])
                self.assertEqual(result["failure"]["code"], "ARCHIVE_CPU_CAP" if guard == "cpu" else "ARCHIVE_RSS_CAP")
                self.assertTrue(path.exists())
                self.assertTrue(result["rawSelectedEvidenceRetained"])
                self.assertFalse((root / "export/selected-evidence.tar.gz").exists())


class BoundedFiles(unittest.TestCase):
    def test_descriptor_reads_reject_symlinks_hardlinks_and_oversized_files(self):
        with tempfile.TemporaryDirectory(prefix="poe-OFFLINE-file-bound-") as directory:
            root = pathlib.Path(directory)
            path = root / "actual"
            path.write_bytes(b"fixture")
            path.chmod(0o600)
            self.assertEqual(module.regular(path, 7, os.getuid(), True), b"fixture")
            with self.assertRaisesRegex(RuntimeError, "BOUNDED_REGULAR_FILE_REQUIRED"):
                module.regular(path, 6)
            link = root / "symlink"
            link.symlink_to(path)
            with self.assertRaises(OSError):
                module.regular(link, 7)
            hard = root / "hard"
            os.link(path, hard)
            with self.assertRaisesRegex(RuntimeError, "BOUNDED_REGULAR_FILE_REQUIRED"):
                module.regular(path, 7)


if __name__ == "__main__":
    unittest.main()
