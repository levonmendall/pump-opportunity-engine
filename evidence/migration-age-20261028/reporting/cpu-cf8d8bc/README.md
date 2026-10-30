# CPU-verification run: actual reporting agreement and stopped state

Run `pilot-20261028024343351-654738bd`, source `cf8d8bcd5b674ba6d510e92c1ae181d3cc6e5e4d`, hash `97369ba7ea222caa3008c97d189718e75b36f56d19dd3fb40a57d6efdf66c258`, used the existing reporting release/deployment `9161d3849eae1ffa549a6afa2a1c263b6f3d1185` / `dep-dbgl96ugekts73889s40`.

A running source report generated **2026-10-28T02:58:23.401Z** exactly matched its complete locally captured allowlisted projection at comparison **02:58:27.646Z**, source age **4.199s**. Its full funnel, metrics, watch/cohort counters, run/source/account/inception, and actual flags matched.

The actual final stopped source report generated **2026-10-28T02:58:38.671Z** exactly matched local final status and was publicly reported as **stopped** at comparison **02:58:43.028Z**, source age **4.325s**. The watcher did not infer stopped state from an expected clock deadline. Both matched reports show `candidate-evaluation`, `entriesEnabled:false`, `financialExecutionAuthorized:false`; no pilot portfolio is published.

**Limitation:** the requested two distinct running cycles were not both verified. The full-snapshot sampler started **02:58:22.176Z**, after an initial read-only local check at **02:57:45Z**. Only one running publisher cycle remained before the actual stopped report. The record therefore contains two distinct actual matched cycles (running + stopped), not two running cycles. `runningCyclesPassed:false` is preserved; no continuity or additional earlier reporting is inferred.

The check used five public dashboard GETs, no market requests, no financial queries/writes, no source edits, no restart/deployment, and no repeated UI tests. `actual-reporting-cycles.json` preserves full bounded reporting snapshots and receipt/comparison times; `summary.json` records the explicit evidence limitation. Historical and earlier interval evidence is unchanged.
