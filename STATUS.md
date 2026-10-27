## Current isolated pilot — 2026-10-27 17:57UTC

A continuous isolated PAPER pilot is running in Cloud from review release `f8bdf1e`, with frozen strategy `persistent-buying-pilot-v1`. Account `poe-pilot-8468add6-f916-48cf-a585-6cd008a81360` was initialized once at `2026-10-27T17:56:13.252Z`, then reopened unchanged after a clean review-fix stop. This is separate from the original authoritative EC2 account. No production or Render write occurred.

Initial start checks cover fresh delayed entry/exit pricing, current rent, exact modeled costs, candidate-gap handling, held exposure, same-account restart and writer exclusivity. The first stage has one candidate or one simulated holding; this is temporary. Discovery continues while holding. Progressive shadow/concurrency tests remain authorized and must report failed contention cases, lost coverage and actual supported concurrency.

At interval start: free migration discovery connected; no eligible candidate yet; entries gated by identity/window/reconciliation/capacity checks; natural PAPER entries/exits0; no positions/pending actions. The changing local scorecard is `/workspace/poe-pilot/status.json`. This paragraph is a start checkpoint, not the final forward result. See [PILOT.md](docs/PILOT.md) for commands, frozen timing and resource limits.

Production remains untouched. Its last public read-only snapshot check was about16:13UTC (not a current systemd/DB verification): original account reconciled, entries disabled, no positions/trades, source about49sold. No24/72h acceptance clock has started. EDGE UNPROVEN. LIVE TRADING DISABLED.

---

# POE status — 2026-10-27 UTC

One authorized diagnostic obtained5validated on-chain market swaps and one usable
60s recorded-information window; bounded independent chain audit5/5matched.
There were no PAPER orders/fills. Production, original account/inception and
Render were untouched; no fresh production-health check occurred in this task.

Protection is not accepted:40three-holding checks had2056ms maxgap/2033ms p95,
21gaps above2s target and no natural stop/TP/max-hold crossing. Recorded observation
75002ms exceeded the75s bound by2ms; no decision information was admitted after
cutoff. This remains a disclosed harness deficiency, not an approved tolerance.

[Actual decision](evidence/scheduler-forward-20261027/decision.json),
[bounded audit](evidence/scheduler-forward-20261027/audit.json) and the final
section of [the evaluation](docs/ADAPTIVE_MONITORING_EVALUATION.md) separate
mapping/window evidence from timing and integration limitations.

| Status | Actual evidence |
| --- | --- |
| BUILT | Installed observer; undeployed trader/accounting/recovery and isolated diagnostic components. Capture source349e67b, approved proposalde102ee |
| RUNNING | Existing EC2 observer preserved; not directly checked in this task. Diagnostic process/socket ended normally |
| OBSERVING CURRENT DATA | New captured interval15:19:07.293–15:20:22.295UTC is closed; no continuing research subscription |
| PAPER-ENTRY ENABLED | No. Installed strategyUNIMPLEMENTED_FLOW_BLOCKED; frozen contract, management wiring, robustness and acceptance incomplete |
| NATURAL PAPER TRADES | Last production source reported0; this diagnostic created0orders/fills/positions |
| ACCOUNTING RECONCILED | Last source report true08:03:56.948UTC; no private financial DB audit in this task |
| DASHBOARD FRESH | Last check08:04:36UTC/snapshot1049, facts39.682s old then. Current freshness not checked; research never published |
| OPERATIONALLY ACCEPTED | No. No24/72-hour clock started |
| EDGE | UNPROVEN |
| LIVE TRADING | DISABLED |

## Preserved authority

Instancei-00044d4ea1471b957, AWS133857166104/us-west-2; restrictedpoe-runtime.service.
Installed releasebce3d22bb434eb429aafacb788a18f39ec189c1b. Original account
poe-3123e352-4581-455b-85db-acd7e825e99e, inception2026-10-26T22:07:36.212Z,
one $1,000 virtual conversion. No bootstrap/reseed, service/credential change,
root installation, wallet operation or infrastructure change.
Public viewer https://meme-machine-dashboard-staging.onrender.com unchanged;
authenticated machine publishing unchanged. No synthetic performance was sent.

## Diagnostic scope and counters

Actual1routed buy_v2,3direct Sells and1routed Sell. All5independent confirmed
responses match original fingerprints/amounts/transfers;2Sells also passed
finalized executed-byte rechecks. Exact-quote Buy variants/multiswap were absent.
All5fall inside the recorded15:19:10–15:20:10availability window; the5/5chain-time
audit does not establish generic receive-window completeness or market coverage.
One buyer100% concentration, negative net buying and0positivebins reject the
existing predictive rule; origin/entry-age eligibility remained unverified.

58newunits bring cumulative usage to221/240;19unused is not retry permission.
Related bytes2,314,558measured +2,097,152olduncertain =4,411,710/67,108,864.
PumpApi actual271,949,619bytes cumulative; reservations396MiB/320s fully committed,
no refunds. New run76,013,520bytes/48,819frames. API fees$0; infrastructure/transfer
costs unverified. Cloud resource results do not establish EC2 capacity.

The single grant is complete. Keep the scheduler in research: offline cutoff/
shutdown hardening and known50/100ms-jitter,3-event-burst and pending-contention
failures must be addressed before production review. No merge/deployment/entries,
new capture, paid provider, wallet or completed setup action is requested.
