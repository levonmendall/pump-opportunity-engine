import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("paper_audit", ROOT / "scripts/audit-retained-paper-trades.py")
audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)


def fill(side, at, identity=None):
    return {"id": identity or side, "mint": "fixture", "side": side, "quantity": "100", "at": at,
            "status": "PAPER filled", "valueUsd": 50 if side == "buy" else 60,
            "executionCostsUsd": 0.001, "reason": "fixture"}


def snapshot(at, run, breaches, unavailable, held=False, maximum=0, started="2026-10-29T00:00:00.000Z"):
    return {"account": {"id": audit.ACCOUNT}, "source": {"release": "fixture"}, "sequence": at,
            "times": {"generatedAt": at}, "positions": [{"mint": "fixture"}] if held else [], "trades": [],
            "balances": {}, "intelligence": {"run": {"id": run, "startedAt": started},
            "protection": {"breaches": breaches, "unavailableChecks": unavailable,
                           "maximumCompletedGapMs": maximum, "completedEvaluationBoundaryMs": 4000}}}


class HistoricalAuditSafetyTests(unittest.TestCase):
    def test_profit_never_excuses_failed_protection(self):
        self.assertEqual(audit.classify(1, True, "0.5"), "INADEQUATELY_PROTECTED_POSITION")

    def test_missing_native_sol_does_not_become_profitable_usd_trade(self):
        self.assertEqual(audit.classify(0, True, None), "INCOMPLETE_OR_UNVERIFIED_EVIDENCE")
        self.assertEqual(audit.classify(0, False, "0.5"), "INCOMPLETE_OR_UNVERIFIED_EVIDENCE")

    def test_duplicate_historical_fill_lists_do_not_duplicate_fills(self):
        s = snapshot("2026-10-29T00:05:00.000Z", "r", 0, 0)
        s["trades"] = [fill("buy", "2026-10-29T00:01:00.000Z"), fill("sell", "2026-10-29T00:02:00.000Z")]
        self.assertEqual(len(audit.collect_fills([s, copy.deepcopy(s)])), 2)
        bad = copy.deepcopy(s)
        bad["trades"][0]["quantity"] = "101"
        with self.assertRaisesRegex(ValueError, "Conflicting fill"):
            audit.collect_fills([s, bad])

    def test_partial_unmatched_close_cannot_be_certified(self):
        buy = fill("buy", "2026-10-29T00:01:00.000Z")
        sell = fill("sell", "2026-10-29T00:02:00.000Z")
        sell["quantity"] = "99"
        with self.assertRaisesRegex(ValueError, "Unmatched or partial"):
            audit.pair_fills([buy, sell])

    def test_inherited_run_counters_are_not_assigned_to_new_trade(self):
        entry = fill("buy", "2026-10-29T00:02:00.000Z")
        exit = fill("sell", "2026-10-29T00:05:00.000Z")
        earlier = snapshot("2026-10-29T00:00:30.000Z", "old", 4, 14, True, 19446)
        earlier["positions"] = [{"mint": "earlier-mint"}]
        before = snapshot("2026-10-29T00:01:00.000Z", "old", 4, 14)
        held = snapshot("2026-10-29T00:03:00.000Z", "old", 5, 17, True, 19446)
        result = audit.audit_protection([earlier, before, held], entry, exit)
        self.assertEqual(result["observedBreachesLowerBound"], 1)
        self.assertEqual(result["observedUnavailableChecksLowerBound"], 3)
        self.assertFalse(result["segments"][0]["maximumAttributableToThisHolding"])

    def test_restart_keeps_counter_scopes_and_visible_observation_gap(self):
        entry = fill("buy", "2026-10-29T00:02:00.000Z")
        exit = fill("sell", "2026-10-29T00:06:00.000Z")
        rows = [snapshot("2026-10-29T00:01:00.000Z", "old", 4, 14),
                snapshot("2026-10-29T00:03:00.000Z", "old", 5, 17, True, 19446),
                snapshot("2026-10-29T00:04:00.000Z", "new", 0, 0, True, 0, "2026-10-29T00:03:30.000Z"),
                snapshot("2026-10-29T00:05:00.000Z", "new", 2, 5, True, 13500, "2026-10-29T00:03:30.000Z")]
        result = audit.audit_protection(rows, entry, exit)
        self.assertEqual(result["observedBreachesLowerBound"], 3)
        self.assertEqual(result["observedUnavailableChecksLowerBound"], 8)
        self.assertTrue(result["restartDuringHoldingObserved"])
        self.assertFalse(result["continuousProtectionIndependentlyProven"])

    def test_retained_four_round_trips_and_protection_findings_reproduce(self):
        directory = ROOT / "evidence/trade-quality-20261029"
        manifest = json.loads((directory / "input-manifest.json").read_text())
        rows = [json.loads(line)["snapshot"] for line in (directory / manifest["file"]).read_text().splitlines()]
        result = audit.audit(rows, manifest)
        self.assertEqual(result["uniqueModeledFills"], 8)
        self.assertEqual(result["closedRoundTrips"], 4)
        by_name = {t["name"]: t for t in result["trades"]}
        self.assertEqual(by_name["AcBX"]["protection"]["observedBreachesLowerBound"], 4)
        self.assertEqual(by_name["8TJ1"]["protection"]["observedBreachesLowerBound"], 3)
        self.assertEqual(by_name["8NTU"]["protection"]["observedBreachesLowerBound"], 0)
        self.assertEqual(by_name["8NTU"]["sampledAccountInterval"]["equitySolDelta"], "-0.073861476")
        self.assertFalse(by_name["Fa24"]["sampledAccountInterval"]["available"])
        self.assertTrue(all(t["verifiedTradeNetSol"] is None for t in result["trades"]))
        # A projection's array-derived IDs must not multiply one timestamped qualification.
        qualifications = [d for d in by_name["8NTU"]["observedDecisions"] if d["stage"] == "qualified"]
        self.assertEqual(len(qualifications), 1)


if __name__ == "__main__":
    unittest.main()
