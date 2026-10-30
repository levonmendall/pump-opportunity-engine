#!/usr/bin/env python3
"""Reproduce a fail-closed historical PAPER trade scorecard from public facts."""
import argparse
from collections import defaultdict
from datetime import datetime
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re

ACCOUNT = "poe-3123e352-4581-455b-85db-acd7e825e99e"
NAMES = {
    "Fa24xN13pzjmcx1dtKP9nBMMFCwLtXCJrtP5hSPKpump": "Fa24",
    "AcBX8a8eHbzQghgqMfqXeAz4kQSRbtHWKUSGXvwMpump": "AcBX",
    "8TJ1uhidGn7PmzEtmftDUJkAxEcLpPNWqdvh42SZpump": "8TJ1",
    "8NTU6e46S8c8VD3uscMAgz8sQYjF2GofuZy4znQwpump": "8NTU",
}
ESSENTIAL_ENTRY_PROOFS = [
    "canonical_pool_and_chain_migration_timestamp",
    "complete_60_second_executed_flow_with_six_10_second_buckets",
    "independent_window_audit_and_completeness_proof",
    "decision_time_buying_pressure_buyers_concentration_and_price_features",
    "actual_size_entry_quote_pool_state_liquidity_and_quote_clock",
    "reservation_risk_checks_and_reconciliation_at_order_admission",
    "native_sol_consideration_gas_fees_rent_and_journal_actions",
]


def millis(value):
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)


def iso(value):
    return datetime.fromtimestamp(value / 1000, tz=datetime.fromisoformat("2000-01-01T00:00:00+00:00").tzinfo).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def run_id(snapshot):
    return (snapshot["intelligence"].get("run") or {}).get("id")


def protection(snapshot):
    return snapshot["intelligence"].get("protection") or {}


def counter_increases(rows, baseline=None):
    """Correlate retained frames without claiming the sampled instant caused failure."""
    output = []
    prior = baseline
    for current in rows:
        p, b = protection(current), protection(prior) if prior else {}
        change = {k: p[k] - b[k] for k in ("breaches", "unavailableChecks") if k in p and k in b}
        if any(v > 0 for v in change.values()):
            provider = current["intelligence"].get("provider") or {}
            before_provider = prior["intelligence"].get("provider") or {}
            output.append({
                "beforeAt": prior["times"]["generatedAt"], "byAt": current["times"]["generatedAt"],
                "counterIncrease": change,
                "lastCompletedAt": p.get("lastCompletedAt"),
                "runMaximumCompletedGapMs": p.get("maximumCompletedGapMs"),
                "providerCounterDelta": {k: provider[k] - before_provider[k] for k in
                                         ("httpTimeouts", "httpErrors", "throttles", "rpcRequests")
                                         if isinstance(provider.get(k), (int, float)) and isinstance(before_provider.get(k), (int, float))},
                "providerAtBracketEnd": provider,
                "resourcesAtBracketEnd": current["intelligence"].get("resources"),
                "qualityAtBracketEnd": current["intelligence"].get("quality"),
                "causation": "Correlation only; physical dispatch/response and per-check traces still required",
            })
        prior = current
    return output


def collect_fills(snapshots):
    fills = {}
    for snapshot in snapshots:
        if snapshot.get("account", {}).get("id") != ACCOUNT:
            raise ValueError("Cross-account input refused")
        for fill in snapshot.get("trades", []):
            if fill.get("status") != "PAPER filled":
                raise ValueError("Only explicitly completed PAPER fills are eligible")
            if fill["id"] in fills and fills[fill["id"]] != fill:
                raise ValueError("Conflicting fill identity: " + fill["id"])
            fills[fill["id"]] = fill
    return sorted(fills.values(), key=lambda f: (f["at"], f["id"]))


def pair_fills(fills):
    open_by_mint, pairs = {}, []
    for fill in fills:
        mint = fill["mint"]
        if fill["side"] == "buy":
            if mint in open_by_mint:
                raise ValueError("Repeated entry without close: " + mint)
            open_by_mint[mint] = fill
        elif fill["side"] == "sell":
            entry = open_by_mint.pop(mint, None)
            if entry is None or int(entry["quantity"]) != int(fill["quantity"]):
                raise ValueError("Unmatched or partial close requires native ledger: " + mint)
            pairs.append((entry, fill))
        else:
            raise ValueError("Unknown fill side")
    if open_by_mint:
        raise ValueError("Unclosed public fill requires position accounting")
    return pairs


def classify(protection_breaches, essential_proofs_complete=False, verified_net_sol=None,
             demonstrated_bad_entry=False, demonstrated_bad_execution=False):
    # Financial return never excuses a demonstrated protection failure.
    if demonstrated_bad_entry:
        return "BAD_ENTRY_DECISION"
    if demonstrated_bad_execution:
        return "BAD_EXECUTION"
    if protection_breaches > 0:
        return "INADEQUATELY_PROTECTED_POSITION"
    if not essential_proofs_complete or verified_net_sol is None:
        return "INCOMPLETE_OR_UNVERIFIED_EVIDENCE"
    return "VALID_WINNING_TRADE" if Decimal(verified_net_sol) > 0 else "VALID_LOSING_TRADE"


def public_fill(fill):
    attempt = re.search(r"execution-attempt:(buy|sell):(\d+):(\d+)", fill.get("reason", ""))
    result = dict(fill)
    result["quantityUnit"] = "token atomic units; token decimals not established by this public projection"
    result["nativeSolConsideration"] = None
    result["nativeSolCostsAndRent"] = None
    if attempt:
        decision_ms = int(attempt[3])
        result["attemptIdentity"] = attempt[0]
        result["attemptTimestampAt"] = iso(decision_ms)
        result["attemptTimestampToFillMs"] = millis(fill["at"]) - decision_ms
        result["delayInterpretation"] = "Difference from timestamp encoded in durable attempt identity; not independently measured provider transport or quote freshness"
    return result


def audit_protection(snapshots, entry, exit):
    mint, start, end = entry["mint"], entry["at"], exit["at"]
    held = [s for s in snapshots if start <= s["times"]["generatedAt"] <= end and
            any(p.get("mint") == mint for p in s.get("positions", []))]
    groups = defaultdict(list)
    for snapshot in held:
        groups[run_id(snapshot)].append(snapshot)
    segments = []
    for run, rows in groups.items():
        first, last = rows[0], rows[-1]
        run_rows = [s for s in snapshots if run_id(s) == run]
        before = [s for s in run_rows if s["times"]["generatedAt"] < start]
        started = (first["intelligence"].get("run") or {}).get("startedAt")
        baseline = before[-1] if before else None
        baseline_kind = "last_retained_pre_entry_run_counter" if baseline else "new_run_zero_counter_baseline"
        # Only a newly started run can establish a zero baseline without a pre-entry frame.
        zero_baseline = baseline is None and started and started >= start
        after = [s for s in run_rows if s["times"]["generatedAt"] >= end and not s.get("positions")]
        endpoint = after[0] if after else last
        p, b = protection(endpoint), protection(baseline) if baseline else {}
        delta = {}
        for key in ("breaches", "unavailableChecks"):
            baseline_count = b.get(key, 0 if zero_baseline else None)
            final_count = p.get(key)
            if baseline_count is None or final_count is None:
                delta[key] = None
            elif final_count < baseline_count:
                raise ValueError("Protection counter decreased inside run: " + str(run))
            else:
                delta[key] = final_count - baseline_count
        prior_other_holding = any(s["times"]["generatedAt"] < start and s.get("positions") for s in run_rows)
        maximum = max((protection(s).get("maximumCompletedGapMs") or 0 for s in rows + [endpoint]), default=0)
        attributable_maximum = not prior_other_holding and (zero_baseline or b.get("breaches") == 0)
        segments.append({
            "runId": run, "sourceRelease": first["source"]["release"],
            "configurationSha256": (first["intelligence"].get("run") or {}).get("configurationSha256"),
            "runStartedAt": started, "heldSnapshotCount": len(rows),
            "firstHeldSnapshotAt": first["times"]["generatedAt"],
            "lastHeldSnapshotAt": last["times"]["generatedAt"],
            "baselineKind": baseline_kind if baseline or zero_baseline else "unknown",
            "baselineAt": baseline["times"]["generatedAt"] if baseline else started,
            "baselineCounters": {k: b.get(k, 0 if zero_baseline else None) for k in ("breaches", "unavailableChecks")},
            "endpointAt": endpoint["times"]["generatedAt"],
            "endpointCounters": {k: p.get(k) for k in ("breaches", "unavailableChecks")},
            "observedCounterDelta": delta,
            "reportedRunMaximumCompletedGapMs": maximum or None,
            "maximumAttributableToThisHolding": attributable_maximum,
            "maximumInterpretation": "Run maximum may belong to an earlier holding" if not attributable_maximum else "No earlier held trade in this run and zero counter baseline",
            "maximumQuoteAgeAtUseMs": max((protection(s).get("maximumQuoteAgeAtUseMs") or 0 for s in rows + [endpoint]), default=0),
            "completedBoundaryMs": protection(first).get("completedEvaluationBoundaryMs"),
            "lastReportedCompletedAt": p.get("lastCompletedAt"),
            "counterIncreaseBrackets": counter_increases(rows + ([] if endpoint == last else [endpoint]), baseline),
            "gapAccounting": "Sampled counter evidence only; absence of retained samples is not continuous supervision proof",
        })
    return {
        "heldSnapshotCount": len(held), "segments": segments,
        "observedBreachesLowerBound": sum(s["observedCounterDelta"]["breaches"] or 0 for s in segments),
        "observedUnavailableChecksLowerBound": sum(s["observedCounterDelta"]["unavailableChecks"] or 0 for s in segments),
        "restartDuringHoldingObserved": len(groups) > 1,
        "continuousProtectionIndependentlyProven": False,
        "interpretation": "Public counters are source assertions, not all per-check quote and timing proofs",
    }


def account_interval(snapshots, entry, exit, all_fills):
    before = [s for s in snapshots if s["times"]["generatedAt"] < entry["at"] and not s.get("positions")]
    after = [s for s in snapshots if s["times"]["generatedAt"] >= exit["at"] and not s.get("positions")]
    if not before or not after:
        return {"available": False, "reason": "No retained immediate flat before-and-after account brackets; USD fills do not establish SOL P&L"}
    first, last = before[-1], after[0]
    other = [f["id"] for f in all_fills if first["times"]["generatedAt"] < f["at"] <= last["times"]["generatedAt"]
             and f["id"] not in (entry["id"], exit["id"])]
    result = {
        "available": True, "beforeAt": first["times"]["generatedAt"], "afterAt": last["times"]["generatedAt"],
        "beforeSequence": first.get("sequence"), "afterSequence": last.get("sequence"),
        "beforeBalances": first.get("balances"), "afterBalances": last.get("balances"),
        "otherRecordedFillIdsWithinBrackets": other,
        "classification": "SAMPLED_FLAT_ACCOUNT_INTERVAL_DELTA_NOT_PER_ACTION_SOL_LEDGER_AUDIT",
        "limitations": "May include failed-attempt costs and locked modeled deposit/rent effects; no historical SOL/USD conversion or candle peak used",
    }
    for field in ("cashSol", "reservedSol", "equitySol"):
        a, b = first.get("balances", {}).get(field), last.get("balances", {}).get(field)
        result[field + "Delta"] = format(Decimal(b) - Decimal(a), ".9f") if a is not None and b is not None else None
    return result


def audit(snapshots, manifest=None):
    snapshots = sorted(snapshots, key=lambda s: s["times"]["generatedAt"])
    fills = collect_fills(snapshots)
    pairs = pair_fills(fills)
    trades = []
    for entry, exit in pairs:
        mint = entry["mint"]
        timing = audit_protection(snapshots, entry, exit)
        decisions = {}
        for s in snapshots:
            for d in s["intelligence"].get("decisions") or []:
                if d.get("mint") == mint:
                    # Public report array-derived IDs vary when the projection
                    # moves; do not count one decision many times as new signals.
                    semantic = {k: d.get(k) for k in ("mint", "at", "stage", "reason")}
                    key = json.dumps(semantic, sort_keys=True)
                    if key not in decisions:
                        decisions[key] = {**semantic, "observedPublicIds": []}
                    if d.get("id") not in decisions[key]["observedPublicIds"]:
                        decisions[key]["observedPublicIds"].append(d.get("id"))
        decision_rows = sorted(decisions.values(), key=lambda d: d.get("at", ""))
        exit_signals = [d for d in decision_rows if "exit" in d.get("stage", "").lower() or
                        any(x in d.get("reason", "") for x in ("maximum-holding-time", "net-liquidation-stop"))]
        trades.append({
            "name": NAMES.get(mint, mint), "mint": mint,
            "classification": classify(timing["observedBreachesLowerBound"]),
            "entry": public_fill(entry), "exit": public_fill(exit),
            "fillEvidence": {
                side: {"firstRetainedPublicMentionAt": next(s["times"]["generatedAt"] for s in snapshots
                                                          if any(f["id"] == fill["id"] for f in s["trades"])),
                       "nativeExecutionSourceIndependentlyEstablished": False}
                for side, fill in (("entry", entry), ("exit", exit))
            },
            "holdingMs": millis(exit["at"]) - millis(entry["at"]),
            "sourceProvenance": "Run source/configuration shown only when contemporaneous held snapshots exist; later preserved fill lists do not establish original execution source",
            "decisionTimeEntryProofs": {name: "NOT_RETAINED_IN_PUBLIC_INPUTS" for name in ESSENTIAL_ENTRY_PROOFS},
            "entryQuality": "UNVERIFIED; a public qualified badge or modeled fill is not independent proof of a valid entry",
            "observedDecisions": decision_rows, "observedExitSignals": exit_signals,
            "protection": timing,
            "sampledAccountInterval": account_interval(snapshots, entry, exit, fills),
            "verifiedTradeNetSol": None,
            "economicInterpretation": "Public USD observations are not native SOL proceeds/costs; no winner/loser certification without native actions/journal and quote evidence",
        })
    return {
        "schemaVersion": 1, "classification": "OFFLINE_RETAINED_PUBLIC_TRADE_QUALITY_AUDIT_NOT_OPERATIONAL_ACCEPTANCE",
        "accountId": ACCOUNT, "networkRequests": 0, "financialDatabaseOpened": False,
        "manifestSha256": hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()).hexdigest() if manifest else None,
        "uniqueModeledFills": len(fills), "closedRoundTrips": len(trades), "trades": trades,
        "summary": {
            "inadequatelyProtected": sum(t["classification"] == "INADEQUATELY_PROTECTED_POSITION" for t in trades),
            "incompletelyVerified": sum(t["classification"] == "INCOMPLETE_OR_UNVERIFIED_EVIDENCE" for t in trades),
            "independentlyCertifiedGoodEntries": 0, "independentlyCertifiedNetSolProfits": 0,
            "wholeMarketOpportunityRecall": None,
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    raw = (args.manifest.parent / manifest["file"]).read_bytes()
    if hashlib.sha256(raw).hexdigest() != manifest["sha256"]:
        raise ValueError("Frozen public facts digest mismatch")
    rows = [json.loads(line) for line in raw.splitlines()]
    if len(rows) != manifest["rowCount"]:
        raise ValueError("Frozen public facts row count mismatch")
    result = audit([r["snapshot"] for r in rows], manifest)
    value = json.dumps(result, indent=2) + "\n"
    if args.output:
        args.output.write_text(value)
    else:
        print(value, end="")


if __name__ == "__main__":
    main()
