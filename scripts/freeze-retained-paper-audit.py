#!/usr/bin/env python3
"""Freeze public historical reporting facts only. No RPC, ledger or service access."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import tarfile
from datetime import datetime

ACCOUNT = "poe-3123e352-4581-455b-85db-acd7e825e99e"
BASE = "evidence/issue11-consolidation-20261028/"
INPUTS = [
    "post-upgrade-forward-20261029/render-before-rebind.json",
    "coherent-entry-forward-20261029/forward-snapshots.ndjson",
    "coherent-entry-forward-20261029/current-financial-1793288269357.json",
    "four-slot-configuration-20261029/holding-before-configuration.json",
    "four-slot-configuration-20261029/four-slot-first-15-minute-snapshots.ndjson",
    "four-slot-configuration-20261029/restart-preserved-autonomous-exit.json",
    "continuous-retention-resource-repair-20261029/forward-02/snapshots.ndjson",
]
ARCHIVE = "entry-readiness-recovery-20261029/cloud-recovery-1756.tar.gz"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def project(d):
    d = d.get("snapshot", d)
    if d.get("account", {}).get("id") != ACCOUNT:
        raise ValueError("Unexpected account in retained public reporting input")
    intelligence = d.get("intelligence", {})
    return {
        "account": d["account"], "sequence": d.get("sequence"),
        "source": d.get("source"), "times": d.get("times"),
        "status": d.get("status"), "balances": d.get("balances"),
        "positions": d.get("positions", []), "trades": d.get("trades", []),
        "intelligence": {k: intelligence.get(k) for k in
                         ("run", "protection", "provider", "resources", "quality", "decisions", "pendingOrders")},
    }


def freeze(repository, output):
    sources, candidates = [], []

    def read_rows(data, path, member=None):
        source = {"path": path, "sha256": sha(data), "bytes": len(data)}
        if member:
            source = {**member, "member": path, "memberSha256": sha(data), "memberBytes": len(data)}
        sources.append(source)
        rows = list(enumerate(data.splitlines(), 1)) if path.endswith(".ndjson") else [(None, data)]
        for line, raw in rows:
            if not raw.strip():
                continue
            value = json.loads(raw)
            if not value.get("snapshot", value).get("times", {}).get("generatedAt"):
                continue
            p = project(value)
            candidates.append({"provenance": {"source": len(sources)-1,
                                               "line": line,
                                               "rawRowSha256": sha(raw),
                                               "snapshotPointer": "/snapshot" if "snapshot" in value else ""},
                               "snapshot": p})

    for relative in INPUTS:
        path = BASE + relative
        read_rows((repository / path).read_bytes(), path)
    path = BASE + ARCHIVE
    raw = (repository / path).read_bytes()
    with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
        for member in archive.getmembers():
            if member.name.endswith(".ndjson"):
                read_rows(archive.extractfile(member).read(), member.name,
                          {"path": path, "sha256": sha(raw), "bytes": len(raw)})

    # Keep all held observations, and the nearest flat frames before/after each
    # retained fill. Public fill lists are historical, not new fills per snapshot.
    candidates.sort(key=lambda r: r["snapshot"]["times"]["generatedAt"])
    by_key = {}
    for row in candidates:
        d = row["snapshot"]
        key = (d["source"]["release"], (d["intelligence"].get("run") or {}).get("id"),
               d.get("sequence"), d["times"]["generatedAt"])
        if key in by_key:
            if canonical(by_key[key]["snapshot"]) != canonical(d):
                raise ValueError("Conflicting retained snapshots with same identity")
            by_key[key]["additionalProvenance"].append(row["provenance"])
        else:
            by_key[key] = {**row, "additionalProvenance": []}
    candidates = list(by_key.values())
    fills = {t["id"]: t for r in candidates for t in r["snapshot"]["trades"]}
    keep = {i for i, r in enumerate(candidates) if r["snapshot"]["positions"]}
    for fill in fills.values():
        before = [i for i, r in enumerate(candidates) if r["snapshot"]["times"]["generatedAt"] < fill["at"]
                  and not r["snapshot"]["positions"]]
        after = [i for i, r in enumerate(candidates) if r["snapshot"]["times"]["generatedAt"] >= fill["at"]
                 and not r["snapshot"]["positions"]]
        if before:
            keep.add(before[-1])
        if after:
            keep.add(after[0])
    # Retain adjacent capture-state transitions around each holding so a
    # successful close cannot hide a simultaneous candidate coverage outage.
    times = [datetime.fromisoformat(fill["at"].replace("Z", "+00:00")).timestamp()
             for fill in fills.values()]
    for i in range(1, len(candidates)):
        prior, current = candidates[i-1]["snapshot"], candidates[i]["snapshot"]
        old = (prior["intelligence"].get("quality") or {}).get("captureConnected")
        new = (current["intelligence"].get("quality") or {}).get("captureConnected")
        at = datetime.fromisoformat(current["times"]["generatedAt"].replace("Z", "+00:00")).timestamp()
        if old != new and any(abs(at - fill_at) <= 120 for fill_at in times):
            keep.update((i-1, i))
    # Flat post-exit frames retain run-level counters hidden by the older UI.
    for i, r in enumerate(candidates):
        d = r["snapshot"]
        if d["times"]["generatedAt"] in ("2026-10-29T15:37:32.064Z", "2026-10-29T16:25:12.731Z"):
            keep.add(i)
    output.mkdir(parents=True, exist_ok=True)
    data = b"\n".join(canonical(candidates[i]) for i in sorted(keep)) + b"\n"
    (output / "public-facts.ndjson").write_bytes(data)
    manifest = {
        "schemaVersion": 1, "accountId": ACCOUNT,
        "classification": "OFFLINE_RETAINED_PUBLIC_REPORTING_PROJECTION_NOT_PRIVATE_LEDGER_AUDIT",
        "networkRequests": 0, "financialDatabaseOpened": False,
        "auditImplementationBase": "84bd3f09995fcbd347710cae5c1ddb8c5f517157",
        "rowCount": len(keep), "file": "public-facts.ndjson", "sha256": sha(data),
        "projectionFields": list(candidates[0]["snapshot"]), "sources": sources,
        "limitations": [
            "Raw source hashes bind original retained public files; projection does not authenticate private ledger state.",
            "Public fills omit native SOL consideration, exact per-action costs and actual-size quote proofs.",
            "Protection counters are run-scoped and sampled; they are not per-trade counters or every completed check.",
            "Snapshot release identifies publishing source, not necessarily the source that originally executed an older historical fill.",
            "No missing quotes, migration proofs, normalized flow or independent audits are reconstructed from later prices."
        ],
    }
    (output / "input-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    manifest = freeze(args.repository, args.output)
    print(json.dumps({"rows": manifest["rowCount"], "sha256": manifest["sha256"]}))
