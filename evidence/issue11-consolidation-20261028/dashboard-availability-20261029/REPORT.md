# Original dashboard availability repair

## Verified cause

The former dashboard combined financial valuation readiness with operating availability. Its receiver classified a snapshot as unavailable when reconciliation was not current, USD equity was unavailable, or a financial valuation timestamp was absent. The headline then combined that classification with `status.market`, which also depends on usable financial prices and marks. Neither field establishes whether native selected-pool capture or broad discovery is connected.

The original trading guards remain unchanged: financial reconciliation must be sufficiently recent, and SOL/USD must satisfy its existing freshness requirement. A periodic report can therefore correctly say entries are paused while the machine is capturing and evaluating candidates.

The independently replayed 57 actual snapshots from 16:51–17:06 UTC contain 39 reconciliation-only false operating-unavailable classifications. Two genuinely disconnected native-capture samples remain explicitly unavailable in the repaired classification. Tests separately cover expired USD valuation, stopped runtime, true source/publisher staleness, browser read failure and held-position protection failures. No snapshot timestamp, balance, entry permission or financial validator was changed.

## Requested 15:16–15:24 UTC interval

An exact contemporaneous source/publisher/provider series for these eight minutes has not been recovered. The retained 15:14:11 host bracket reports the original source running, feed connected, healthy host memory/disk and some CPU throttling. It does not establish those measurements throughout the subsequent interval. A later source snapshot contains the historical PAPER sell at 15:16:50.857 UTC, proving financial activity then, rather than continuous market or reporting availability.

Searches of retained local artifacts and compressed logs are documented here. Render returned empty log and metric series for the requested interval; that does not prove there was no traffic or incident. Evidence-storage pressure, SOL/USD failures, reconciliation delay, capture interruptions, CPU throttling and acknowledgments cannot be allocated precisely within these eight minutes from the currently accessible facts.

A bounded read-only exporter is staged separately. It permanently assumes the existing runtime identity before private reads, exports only sanitized fixed-window financial/log facts, and performs no service control or financial writes. Its owner-only execution is pending. Missing historical facts are not replaced with current observations.

## Deployed verification

- Dashboard source: `9bdf59aa9ca4fe2af92dfeecd65cfa6ab8346fe1`, based on and preserving the owner's `cb4f53d` candidate-bar change.
- Existing Render deploy: `dep-dbho91m1egvs738350q0`, live at 17:39:41.868 UTC.
- Full dashboard repository suite: 247/247 passed; focused verification: 51/51; build and independent review passed. The initial presentation-test harness failure and its correction are retained in the dashboard branch evidence.
- Actual mobile and desktop browsers at 17:40:53 displayed `RUNNING · OBSERVING` with entries enabled, and with entries paused and the reconciliation warning displayed separately. No JavaScript errors or horizontal overflow were observed.
- Two distinct original source timestamps were accepted. A subsequent EC2 receipt confirms the same supervisor/native/publisher PIDs and zero restarts; no financial service restart was used for this repair.
- Source freshness and publisher receipt still use the existing 90-second boundary. Duplicate deliveries do not refresh the original source or receipt timestamps.

Actual browser evidence and the Render deployment receipt are in `live-deployed/`. Source implementation, tests, sanitized replay and raw verification outputs are retained at commit `9bdf59a`, under `evidence/render-source-freshness-20261029/`.

## Remaining genuine operating failures

The later frozen 114-snapshot comparison from 17:06–17:34 records four selected-capture interruption episodes, 41 additional candidate-scope gaps and 37 HTTP timeouts. Broad discovery/watch remained connected; required-evidence refusal and storage-recovery counters remained zero. These are real coverage limitations, distinct from the repaired headline classification. Their exact private transport causes remain unknown. See the independently reproducible `../continuous-retention-resource-repair-20261029/forward-02/` evidence.

The same interval includes a natural PAPER entry and stop exit. Position protection continued during a selected-capture interruption, with a reported maximum completion gap of 2.555 seconds and no recorded protection breaches. This is useful lifecycle evidence, not profitability or continuous-operation acceptance.
