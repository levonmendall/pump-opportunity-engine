# Two-position operating integration — 2026-10-29

This is OFFLINE, disposable-account evidence. No EC2 action, network/provider request, authoritative-ledger access, live market trade, deployment or profitability claim was made by this task. The deployment coordinator must freeze and validate the final combined source and install it into the existing original service. The approved target is TWO holdings / FOUR deep scopes; it does not create a new account or reporting endpoint.

Base source: `3ef284cbc713010fcdf9f9e6f5842a64e153b093`. Exact final application/test file hashes are in `source-identity.json`. Node v24.19.0. `configuration-comparison.json` binds the intended original account, unchanged strategy/execution, count-only risk change and provider policy. Target configuration SHA256: `7e1d449a053a8cad89ff7b5e9dc84c01f118cbeeeaeea9958473b75f6a547292`. This hash is source-derived, not evidence of installation.

## Verified defects and repairs

1. Complete native candidate preparation previously called `ledger.resume()` without the owner/hard-stop authority checks used by general cash readiness. All three original full-SDK negative tests failed (`full-path-hard-stop-before.raw.txt`). The candidate now checks current safety and account/revision-bound internal-stop proof before preparation and again after awaited preparation/protection. It preserves owner/unknown/hard stops and uncertainty. It still recovers explicitly allowlisted temporary preparation failures with a new independently audited window while the first holding remains owned. An awaited preparation failure cannot overwrite a newly received hard/owner reason.
2. A second entry's decision quote/rent plus modeled delay and pending execution delayed the first holding's fresh completed protection evaluation. The retained 350ms fixture measured 4600ms. The candidate now performs one fresh shared held-protection pass after decision work, before the new buy's modeled attempt. An old mark is never counted as a newly completed quote: the fixture uses the installed launcher's same-unit, valid-source, <=2s, strictly-increasing-quoteAt completion semantics. Steady held operation still uses one union account/Clock read for both exact-size holdings.
3. The existing management reserve considered minute headroom but omitted the same physical gate's 20-start/10s ceiling. Cold preparation could consume the last short-window slot and delay existing holding protection by 4880ms. Versioned policy v2 applies the existing entry-six/observation-four start headroom to BOTH rolling windows, and each candidate request rechecks entry headroom. No configured provider rate, physical concurrency, spacing, quote age or protection boundary was raised. Independent review identified that the old source-admission callback also gated already delivered notifications. Capture safety is now explicitly separate from physical work admission: pure RPC headroom never creates a notification gap, while genuine resource/required-evidence/owner cutoff still refuses information. Real PilotNativeFlow retained-log tests cover entry headroom6→5 and observation4→3 without a gap or redundant support request.

## Final checks

- `node --import tsx --test test/native-paper-integration.test.ts test/native-paper-readiness.test.ts test/native-paper-service.test.ts test/research-held-market.test.ts`: **79/79 PASS**, `focused-final-second.raw.txt`.
- Additional capture/launcher/native-flow integration: **173/173 PASS**, `capture-independent-final.raw.txt`.
- `npm run build`: **PASS**, `capture-independent-build.raw.txt` (final capture-admission split).
- `node --import tsx --test evidence/two-position-operating-20261029/guarded-two-position.mts`: **3/3 PASS**, `guarded-capture-independent-final.raw.txt` (final capture-admission split).
- Earlier complete `npm test`: **1829/1830 PASS**, `npm-test.raw.txt`. Its one failure was an older test that explicitly expected a hard reason, outside the temporary whitelist, to be cleared by candidate preparation. That test is corrected to require the hard latch remain closed, and passes in the final focused suite. The coordinator will run ONE final full suite on the combined source, including the separate capture-recovery repair. This directory does not claim a final full-suite pass.

The final native/SDK controls include two entries, independent stop/take-profit exits, one exit preserving the other holding, simultaneous maximum-hold exits, uncertain exits and restart quarantine, legacy single-profile held recovery and safe cancellation of an unattempted legacy buy, unchanged funding/inception, exact gas/P&L reconciliation, no duplicate fills, temporary second-preparation failure/fresh-window recovery while first held, owner/hard controls before and during awaited preparation, and original two-second financial/mark freshness guards.

## Sustained controlled demand

| Synthetic response latency | Opened/closed | Maximum genuinely fresh completed gap | Completed checks | Physical starts | Maximum starts/rolling minute |
| --- | --- | --- | --- | --- | --- |
| 120ms | 2 / 2 | 2770ms | 692 | 594 | 54 |
| 350ms | 2 / 2 | 3100ms | 622 | 573 | 53 |

Each holding remains open until its actual unchanged 15-minute maximum-hold rule. One physical request remains in flight at most; twenty/10s, 250ms minimum spacing and the explicit 90/minute research profile remain enforced. The 90/minute profile is not proven provider capacity. Financial fixture state and exact starts are retained in `guarded-120.json` and `guarded-350.json`. A second entry can wait for short-window capacity and requires a later complete audit; no old signal/order is forced through.

The finite fake HTTP429 case is a **genuine failed protection interval**, not a healthy-throughput pass: existing provider backoff leaves a 9300ms fresh-pricing gap. The production-equivalent hard-stop is applied; first exposure is preserved, protection resumes when data returns, second exposure is withheld, and restart retains this safety condition. See `http429-recovery.json` and `adverse-third.raw.txt`. No claim is made that a provider outage can be repaired by fabricated marks or that this adverse interval meets acceptance.

## Limits and retained iterations

- Account bytes come from the already retained supported pools. Flow, common bank/Clock, USD, reserves, migration retiming and transport latency are explicitly synthetic. Retained originals are never rewritten.
- The fixture composes the real NativePaper, NativeCandidateRunner, PilotMarket, SDK, PaperLedger, PilotRpc and production-equivalent request/admission/completion callbacks. It does not execute the complete systemd launcher. Resource/backup/supervision availability is held healthy in this controlled test; EC2 resource and reporting proof must be collected after installation.
- The fixture uses four as the configured deep maximum but only two distinct retained supported pools. Sustained history pages represent competing physical demand, not four complete actual candidate windows. The separate existing four-scope deadline/fairness suite remains required in the combined regression/forward validation.
- Genuine forward concurrent holdings, EC2 protection under live latency, resource impact and both holdings on the original Render Portfolio Overview remain **NOT VERIFIED BY THIS TASK**. Do not claim sustained autonomous two-position acceptance from these fixtures.
- `guarded-*.raw.txt`, `attempt-*.json`, debug records and other raw outputs preserve failed/intermediate drafts. Their raw output is genuine, but intermediate source drafts were not individually committed. Only the final named fixture and `source-identity.json` describe the final tested source. These iterations include fixture debugging (clock steps, expected reason strings and close-loop duration) as well as the demonstrated application defects; they must not be combined into one measurement segment.
