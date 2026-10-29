#!/usr/bin/env python3
"""Offline retained-reference catalog. No providers, private status or ledger."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
inputs = []


def read(relative):
    path = ROOT / relative
    raw = path.read_bytes()
    inputs.append({"path": relative, "bytes": len(raw),
                   "sha256": hashlib.sha256(raw).hexdigest()})
    return json.loads(raw)


base = "evidence/opportunity-coverage-20261027/"
cohort = read(base + "reference-current-indexed-cohort.json")
cross = read(base + "indexed-cohort-poe-crosscheck.json")
ranking = read(base + "cohort-ohlcv-20261027T235506594Z-analysis.json")
si = read(base + "si-local-lifecycle.json")
si_flow = read(base + "si-final-window-assessment.json")
frongus = read(base + "frongus-quote-feasibility.json")
ingus = read("evidence/age-origin-20261028/pilot-ingus-origin-20261028033629189/receipt.json")
continuation = read("evidence/age-reference-20261028/continuation-001/receipt.json")

cases = []
wanted = {"2mPwr92SEnFKdMPGJYbCkuicCmXHtVFPse2AvFXTpump",
          "2nPPKzFCYDZLqHxJJdFJA1iV2V4ZqV9K6z8qSiYTpump",
          "8Tgbaw4G7pvnneMoNY5t7597uKEKkFQcnobJzynjpump"}
for row in cross["cases"]:
    if row["identity"]["mint"] in wanted:
        cases.append({key: row[key] for key in (
            "identity", "untrustedDisplayName", "classification", "interpretation",
            "timing", "counts", "historicalStrongTradableOpportunityEstablished")})

prospective = []
paths = [
    "evidence/age-reference-20261028/native-two-hour-40642437328/receipt.json",
    "evidence/age-reference-20261028/resumed-native-40704936322/receipt.json",
    "evidence/missed-opportunity-baseline-20261029/inputs/recovery-native-40714364745.receipt.json",
]
for path in paths:
    row = read(path)
    prospective.append({
        "receipt": path, "classification": row["classification"],
        "startedAt": row["startedAt"], "completedAt": row["completedAt"],
        "segment": row["segment"], "actualRuntimeEnd": row["actualRuntimeEnd"],
        "runtimeIntersectionVerified": row["runtimeIntersectionVerified"],
        "stopReason": row["stopReason"], "listedRows": len(row["rows"]),
        "uniqueListedPools": len({r.get("pool") for r in row["rows"] if r.get("pool")}),
        "selectedBeforeOutcomes": len(row["selected"]),
        "selectionArms": {arm: sum(r["arm"] == arm for r in row["selected"])
                          for arm in sorted({r["arm"] for r in row["selected"]})},
        "retainedOutcomes": len(row["outcomes"]), "usage": row["usage"],
        "selectedIdentities": [{k: r.get(k) for k in ("mint", "pool", "arm", "frozenAt")}
                               for r in row["selected"]],
        "opportunityRecall": None,
    })

tools = [
    "scripts/select-independent-pool-reference.mjs",
    "scripts/analyze-independent-cohort-ohlcv.mjs",
    "scripts/evaluate-frongus-quote-feasibility.mjs",
    "scripts/audit-opportunity-counterfactuals.mjs",
    "scripts/capture-independent-two-hour-reference.ts",
    "scripts/capture-forward-reference.ts",
    "scripts/capture-age-reference.ts",
]
tool_inventory = []
for relative in tools:
    raw = (ROOT / relative).read_bytes()
    tool_inventory.append({"path": relative, "bytes": len(raw),
                           "sha256": hashlib.sha256(raw).hexdigest(),
                           "networkCapable": "/capture-" in relative,
                           "executedByThisCatalog": False})

result = {
    "kind": "retained-independent-opportunity-baseline-v1",
    "historicalResearchOnly": True,
    "currentRuntimeEffectivenessEstablished": False,
    "marketCensus": False,
    "wholeMarketRecall": None,
    "sampledExecutableOpportunityRecall": None,
    "sampledMissedExecutableProfitCount": None,
    "historicalPopulation": {k: cohort[k] for k in (
        "classification", "requestWindow", "pageCount", "sourceRowCount",
        "uniquePoolCount", "canonicalSOLCount", "canonicalSOLAgeOverlapLeads",
        "canonicalSOLMainBenchmarkLeads", "limitations")},
    "historicalTraceIncidenceNotWinnerRecall": cross["summary"],
    "threeIndexedCases": cases,
    "indicativePriceRankingNotExecutableProfits": ranking[
        "rankingByStrongestExact1Or5Or15MinuteClosePairWhollyWithinOneActualRun"],
    "si": {"mint": si["mint"], "pool": si["pool"],
           "headlineFindings": si["headlineFindings"],
           "researchInterruption": si["researchInterruptionCoveringIndexedRally"],
           "flowConclusion": si_flow["conclusion"]},
    "frongusExecutionLimits": {"method": frongus["method"],
                               "mainRallyQuestion": frongus["mainRallyQuestion"],
                               "limitations": frongus["limitations"]},
    "ingusLaterOriginRecovery": {"origin": ingus["origin"],
                                 "failure": ingus["failure"],
                                 "physicalStarts": ingus["physicalStarts"],
                                 "physicalSettled": ingus["physicalSettled"]},
    "laterFrozenIndexSnapshot": {"startedAt": continuation["startedAt"],
                                 "completedAt": continuation["completedAt"],
                                 "listedRows": len(continuation["rows"]),
                                 "unverifiedLeads": len(continuation["leads"]),
                                 "selection": continuation["selection"]},
    "prospectiveSamples": prospective,
    "reusableTools": tool_inventory,
    "inputs": inputs,
    "networkRequests": 0, "financialDatabaseOpened": False,
    "productionChanged": False,
}
print(json.dumps(result, indent=2, sort_keys=True))
