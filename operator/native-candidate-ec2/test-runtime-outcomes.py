"""Offline supervisor regressions; all source/status/ACK data below is synthetic.
No provider, EC2, credential or financial state is accessed.
"""
import importlib.util
import json
import pathlib
import tempfile
import unittest

PATH = pathlib.Path(__file__).with_name("run-bounded.py")
spec = importlib.util.spec_from_file_location("bounded_supervisor", PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def source(**patch):
    value = {"running": False, "startedAt": 1000000, "generatedAt": 1890010, "elapsedMs": 890010, "stopRequestedAt": 1890000, "logicalObservationCutoffAt": 1890000, "stopReason": "logical observation cutoff reached; shutdown reserve begins", "engine": {"rpc": {"fatal": None}, "counters": {"auditedWindows": 0, "predictiveAssessments": 0, "uniqueEvaluated": 0}}}
    value.update(patch)
    return value


class RuntimeOutcomes(unittest.TestCase):
    def test_recorded_fatal_stop_shape_is_not_rescued_by_exit_zero_or_receiver_success(self):
        # Reproduces the material fields from the original20.651s negative run.
        value = source(generatedAt=1020651, elapsedMs=20651, stopRequestedAt=1020649, stopReason="NATIVE_RESEARCH_RPC_FATAL", runnerExit=0, finalStoppedReportAccepted=True, physicalSettlementConfirmed=True, engine={"rpc": {"fatal": "COMPONENT_DISPATCH_EXPIRED"}, "counters": {"auditedWindows": 0, "predictiveAssessments": 0, "uniqueEvaluated": 0}})
        result = module.runtime_outcome(value)
        self.assertEqual(result["classification"], "fatal-source-stop")
        self.assertEqual(result["failureReason"], "NATIVE_RESEARCH_SOURCE_FATAL_STOP")
        self.assertFalse(result["mechanicallyCompleted"])
        self.assertEqual(result["actualRunElapsedMs"], 20651)

    def test_quiet_normal_interval_is_mechanically_complete_not_window_validation(self):
        result = module.runtime_outcome(source())
        self.assertEqual(result["classification"], "mechanically-completed")
        self.assertIsNone(result["failureReason"])
        self.assertTrue(result["plannedAdmissionCutoffReached"])
        self.assertEqual(result["plannedRunDurationMs"], 900000)
        self.assertEqual(result["plannedAdmissionDurationMs"], 890000)
        self.assertEqual(result["candidateWindowEvidence"]["classification"], "no-audited-window-evidence")
        self.assertTrue(result["candidateWindowEvidence"]["mechanicalCompletionIsNotWindowValidation"])

    def test_audited_views_are_reported_without_readiness_or_independent_minutes_claim(self):
        value = source(engine={"rpc": {"fatal": None}, "counters": {"auditedWindows": 10, "predictiveAssessments": 10, "uniqueEvaluated": 2}})
        result = module.runtime_outcome(value)
        self.assertEqual(result["candidateWindowEvidence"]["classification"], "audited-window-views-recorded-not-readiness")
        self.assertEqual(result["candidateWindowEvidence"]["uniqueEvaluated"], 2)
        self.assertTrue(result["candidateWindowEvidence"]["overlappingViewsAreNotIndependentCoverage"])

    def test_early_normal_stop_overrun_unknown_stop_and_missing_source_fail_closed(self):
        cases = [(source(generatedAt=1020000, elapsedMs=20000, stopRequestedAt=1020000), "premature-source-stop"), (source(generatedAt=1900001, elapsedMs=900001), "planned-duration-overrun"), (source(stopReason="NATIVE_RESEARCH_STORAGE_HEADROOM"), "interrupted-or-failed-source-stop"), (None, "unavailable-source-outcome")]
        for value, expected in cases:
            with self.subTest(expected=expected):
                result = module.runtime_outcome(value)
                self.assertEqual(result["classification"], expected)
                self.assertIsNotNone(result["failureReason"])

    def test_elapsed_cannot_hide_a_longer_wall_span_or_fabricate_zero_duration_completion(self):
        for value in [source(elapsedMs=0), source(generatedAt=1900001, elapsedMs=890000)]:
            with self.subTest(elapsed=value["elapsedMs"]):
                result = module.runtime_outcome(value)
                self.assertEqual(result["classification"], "invalid-source-timing")
                self.assertFalse(result["mechanicallyCompleted"])
                self.assertEqual(result["actualWallSpanMs"], value["generatedAt"] - value["startedAt"])


class AcceptedSnapshots(unittest.TestCase):
    def test_only_actual_current_source_bytes_for_two_distinct_accepted_cycles_are_retained(self):
        binding = {"accountId": "poe-pilot-fixture", "inceptionAt": 1}
        with tempfile.TemporaryDirectory(prefix="poe-OFFLINE-reporting-snapshots-") as name:
            root = pathlib.Path(name)
            (root / "run").mkdir(mode=0o700)
            path = root / "run/status.json"
            log = root / "publisher.log"
            retained = []
            original = module.regular
            # Fixture files belong to the current test UID, not host-only994.
            module.regular = lambda p, maximum, owner=None, private=False: original(p, maximum, None, private)
            try:
                for index in range(3):
                    at = 1000000 + index * 15000
                    data = {**binding, "running": True, "generatedAt": at, "runId": "fixture-only", "engine": {"counters": {"predictiveAssessments": index}}}
                    raw = (json.dumps(data) + "\n").encode()
                    path.write_bytes(raw)
                    path.chmod(0o600)
                    before_count = len(retained)
                    module.capture_accepted_source(root, binding, retained)
                    self.assertEqual(len(retained), before_count, "a stale previous ACK cannot reconstruct the new current source")
                    ack = {"published": True, "result": "accepted", "accountId": binding["accountId"], "runId": "fixture-only", "running": True, "sourceAt": at, "sourceAgeMs": 100}
                    with log.open("a") as f:
                        f.write(json.dumps(ack) + "\n")
                    log.chmod(0o600)
                    module.capture_accepted_source(root, binding, retained)
                    module.capture_accepted_source(root, binding, retained)
                    if index < 2:
                        captured = root / "reporting-evidence" / ("accepted-source-" + str(index + 1).zfill(3) + ".json")
                        self.assertEqual(captured.read_bytes(), raw)
                        self.assertEqual(captured.stat().st_mode & 0o777, 0o600)
                        self.assertEqual(retained[index]["sourceSha256"], module.digest(raw))
                self.assertEqual(len(retained), 2)
                self.assertEqual(len(list((root / "reporting-evidence").glob("*.json"))), 4)
                self.assertEqual([r["sourceAt"] for r in retained], [1000000, 1015000])
            finally:
                module.regular = original


class ExportFailureEvidence(unittest.TestCase):
    def test_fallback_has_hashes_and_explicit_selected_evidence_omissions(self):
        with tempfile.TemporaryDirectory(prefix="poe-OFFLINE-export-failure-") as name:
            root = pathlib.Path(name)
            (root / "run/events").mkdir(parents=True)
            (root / "run/rpc").mkdir()
            event = root / "run/events/events-001.ndjson"
            event.write_text('{"fixture":"selected-flow-only"}\n')
            book = root / "run/rpc/chapter-001.json"
            book.write_text('{"fixture":"counterbook-only"}\n')
            (root / "not-an-export-input").write_text("DO-NOT-INCLUDE")
            result = module.export_failure_manifest(root, RuntimeError("COMPLETE_ARTIFACT_CAP"), {"failure": "FULL_EVIDENCE_EXPORT_NOT_VERIFIED"})
            value = json.loads(pathlib.Path(result["failureManifest"]).read_text())
            self.assertFalse(value["fullEvidenceExportVerified"])
            self.assertEqual(value["reason"], "COMPLETE_ARTIFACT_CAP")
            self.assertEqual(value["omittedSelectedEvidence"], [{"path": "run/events/events-001.ndjson", "bytes": event.stat().st_size, "sha256": module.digest(event.read_bytes())}])
            self.assertEqual([row["path"] for row in value["fallbackIncludedFiles"]], ["run/rpc/chapter-001.json"])
            self.assertNotIn("DO-NOT-INCLUDE", pathlib.Path(result["failureManifest"]).read_text())
            self.assertEqual(pathlib.Path(result["failureManifest"]).stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
