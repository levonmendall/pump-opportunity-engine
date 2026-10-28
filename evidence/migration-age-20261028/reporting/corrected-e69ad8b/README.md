# Corrected e69ad8b frozen interval: actual reporting agreement

The existing deployed reporting commit `9161d3849eae1ffa549a6afa2a1c263b6f3d1185` (`dep-dbgl96ugekts73889s40`) accepted the corrected candidate-only source `e69ad8bf012582a004b1820f28743e6e3e34d056`, source hash `07590f2df97516d595f24bc7d12ec3b5041b91d275bac101cd643bd86e6bc16b`, run `pilot-20261028022044929-0a67e810`.

Two distinct accepted reports exactly matched locally captured, timestamp-keyed status projections for source identity, account/inception, policy, age cohorts, observation counts/queues, configured/active deep slots, and promotion/re-promotion counters. See `two-reporting-cycles.json` and `summary.json` for exact source/receipt/comparison timestamps.

Cohorts changed from pre-entry/entry-age/selected-older **2/8/11** to **2/8/12**; observation-known **21 → 22**, observation-ready queue **0 → 3**, active deep **5 → 4 of 6**, promotions **307 → 308**, re-promotions **222 → 223**. This is actual reporting agreement, not a causal improvement or strategy-quality claim. Source age at comparison was **12.420s** and **7.516s**; both reports were `reporting`.

The account/inception remain `poe-pilot-8468add6-f916-48cf-a585-6cd008a81360` / `2026-10-27T17:56:13.252Z`. Read-only local status confirmed candidate-evaluation mode, entries disabled, and financial execution unauthorized. Prior negative 1657bb4 results and previous reporting evidence were not overwritten.

This check performed dashboard GETs and bounded local-status reads only. No market requests, financial writes, code edits, deployment, or repeated UI tests occurred.
