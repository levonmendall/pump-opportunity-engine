# Three frozen intervals, including lean watch lookups

The `cf8d8bc` interval ended naturally at **02:58:38.671 UTC**, after **895.320 seconds**, preserving the predeclared shutdown reserve in its 900-second finite schedule. There was no resource failure. It used the same frozen configuration `4f159a554019e1d9c52af7df825b4ccbd4e43dedae5ead7ef771013c2001a18d` and candidate-only financial nonauthorization.

| Actual measurement | `1657bb4` | `e69ad8b` | `cf8d8bc` |
|---|---:|---:|---:|
| Elapsed seconds | 318.444 | 765.250 | 895.320 |
| Distinct admitted / assessed | 4 / 3 | 22 / 17 | 25 / 21 |
| Maximum simultaneous scopes | 2 | 6 | 6 |
| Complete feature endpoints | 3 | 36 | 57 |
| Retrospectively audit-covered endpoints | 3 | 33 | 51 |
| Actual predictive assessments | 3 | 32 | 50 |
| Predictive passes | 0 | 0 | 0 |
| Audited lookback union, candidate-seconds | 180 | 1,930 | 3,010 |
| Audited lookback union, wall-seconds | 120 | 650 | 860 |
| Whole-process CPU seconds | 63.058 | 240.415 | 165.929 |
| Broad PumpApi received bytes | 224,991,433 | 678,746,349 | 870,659,855 |
| RPC starts / accounted response bytes | 35 / 802,386 | 390 / 11,002,824 | 491 / 9,203,850 |

Compared with `e69ad8b`, measured CPU fell 31.0% while elapsed time rose 17.0% and broad-stream receipt rose 28.3%. CPU per received MiB fell 46.2%. These are different chronological markets and work mixtures, not a controlled causal speedup or proof of better opportunity recognition. Broad-stream filtering does not reduce received traffic; additional transfer costs remain unverified.

The latest interval produced one valid early assessment: `3B2KzDNM4R731ChMmsQPDHpc1gKNa9ycuoim8LJQpump` at age **4.464 minutes**. Its audited window had zero trades and failed the unchanged buying predicates. Four other early tokens did not obtain audited early assessments because of independent-audit or enrichment-capacity limitations. The 2–6-hour cohort obtained 12 audit-covered windows and 12 failed predictive assessments. No 6–24-hour observation was established.

Audit coverage and actual recognition remain distinct. The `e69ad8b` extra audit-covered endpoint was verified after its original bucket. In `cf8d8bc`, one `5jV…` window ending **02:55:50** was audit-ready at **02:55:56.767**, and its information-pending flag became false, but no actual assessment followed before the bucket closed. Other-mint enrichment remained queued. The candidate-only CPU evaluation branch incorrectly shares a network-work admission gate that refuses work while any candidate enrichment is pending. `unassessed-ready-window.json` preserves the exact recorded timeline and hash-verified frozen source excerpts. The result remains 50 actual assessments; no retrospective pass is inserted.

`scorecard.json` contains A–I cohorts, first admissions versus allocated-time overlap, complete-feature versus audit-covered windows, actual audit availability, individual early failures, and the five previously frozen indexed leads. Ages use 106 strictly redecoded original confirmed/finalized migration identities. Only FRONGUS among those five indexed leads has a joined strict origin; no recall denominator or executable-profit claim is supported.

Reproduce from the existing checkout and retained private market archives:

```bash
prlimit --cpu=60:65 --nofile=64:64 --fsize=16777216:16777216 -- \
  node --max-old-space-size=512 --import tsx scripts/score-age-forward.mjs \
  --run=pilot-20261028024343351-654738bd \
  --out=/tmp/poe-age-forward-three-run-reproduction
```

The original two-run defaults and original `final/scorecard.json` remain unchanged. Additional run IDs are validated, deduplicated and bounded to six extras; files remain capped at 32 MiB. No network, financial database, production source, strategy or account changes were made.
