# Historical protection follow-up

This extends the existing four-trade audit in `evidence/trade-quality-20261029`; it does not replace its corpus, classifications, financial history or evidence request. The original seven tests passed again and its scorecard was reproduced **byte for byte**, SHA256 `2ee7988ee1654bbf5d951a6008464956d15179f567f5e525bff335a056a9a7a2`. Commands and raw output are retained here. No provider request, private-ledger read, financial write, service control or application-source change occurred.

## Verified historical facts

| Holding | Retained lifecycle, 2026-10-29 UTC | Protection evidence | Judgment |
|---|---|---|---|
| AcBX | Buy 15:01:47.821; sell 15:16:50.857; 903.036 seconds | At least 4 breaches and 14 unavailable checks; observed maximum completion gap 13,745 ms | Inadequately protected position |
| 8TJ1 | Buy 16:08:35.958; sell 16:23:37.938; 901.980 seconds, spanning a configuration restart | At least 3 attributable breaches and 8 unavailable checks; post-restart maximum 13,500 ms | Inadequately protected position |

The target was a completed usable protection evaluation every two seconds, with a four-second completion boundary. These were actual reported failures; a subsequent sale or favorable displayed return does not erase them. Native fill-level SOL profit/loss and independently complete decision-time entry quality remain unverified for both trades.

8TJ1's pre-restart run already contained AcBX's 4 breaches/14 unavailable checks. Its attributable pre-restart increment is **1/3**, followed by **2/5** in the new run. The pre-existing 19,446 ms run maximum cannot be assigned to 8TJ1. The original quantity and entry time survived the restart, but the public samples do not prove uninterrupted protection across it.

Five of the seven retained breach-increase brackets have no increase in physical HTTP timeout, HTTP error or throttle counters. One post-restart 8TJ1 bracket has one timeout; AcBX's final bracket includes 31 timeouts across a much wider period extending beyond its sale. That last broad bracket cannot identify the exact cause or time of its fourth breach. Endpoint CPU samples are low, but intermittent CPU, disk, event-loop or request stalls between samples remain possible. Zero new HTTP timeouts also does not establish that pricing was dispatched, returned valid data, or completed before its deadline.

The precise physical-request, pacing, queue, local-processing and persistence causes of AcBX/8TJ1 remain **UNKNOWN / INSUFFICIENT EVIDENCE**. Correlation supports investigating scheduling and shared acquisition; it cannot identify a particular responsible function. The later 8NTU lifecycle reported 2,555 ms maximum gap and no breaches despite selected-capture interruptions, illustrating that capture connectivity and holding protection must be measured separately.

## What source93 changes can and cannot establish

The source mapping is pinned to executable commit `93bf0b5d6a3f1258a74ac696798fb4e0ec6147a2`, with eleven immutable file hashes in `historical-protection-followup.json`. Installation and forward verification belong to the parent's separate actual-host evidence.

| Verified engineering mechanism or requirement | Implemented response in source93 | Historical attribution |
|---|---|---|
| Synchronous per-receipt counterbook durability can block timers; the controlled actual-class reproduction delayed a 50 ms timer by 12.4 seconds | Durable conservative prefunding, coalesced exact receipt accounting and settlement checkpoints | The similar historical 13-second gaps do **not** prove this was their cause |
| The complete candidate SDK preparation continuation previously lacked a whole-operation deadline and shared held-pricing state | Bounded preparation, separate held/discretionary pricers, financial-runway clipping and safe yields between physical requests | Source defect and controlled repair are established; AcBX/8TJ1 physical traces are missing |
| Candidate preparation errors could impose a global financial pause | Candidate-local technical reevaluation and canonical financial-only permission recovery | Addresses persistent entry pauses; does not retroactively explain a protection deadline breach |
| Ready audits and financial work compete for the same physical provider gate | Operation-aware admission and actual warm all-held protection before an otherwise unserviceable audit opportunity, preserving provider headroom and financial priority | Improved controlled scheduling is not proof of a historical or forward failure disappearing |
| Restarted counters can hide accumulated failures or confuse their attribution | Validated historical lower bounds merge by MAX; no old completion timestamp, quote freshness or healthy streak is restored | Preserves failures; the original AcBX/8TJ1 audit's separate run deltas remain authoritative |
| A technical protection stop must recover without bypassing safety | New actual all-inventory protected interval of at least 60 seconds, no completion gap above four seconds, current financial/source safeguards and mandatory revision-checked recovery record | Historical failures remain failures after any successful recovery |

Financial FULL/WAL durability, mandatory qualification evidence, actual-size pricing and uncertain-order safeguards remain required. The repair does not establish that all possible synchronous work or provider interruptions are eliminated. Actual completed protection intervals, new breaches, unavailable checks and precise held-pricing reason codes must continue to be measured under market demand.

## Exact evidence still missing

The existing `protected-evidence-request.json` identifies the eight immutable attempt action IDs and four narrow historical windows. For these two holdings, the minimum request is the four matching buy/sell attempt journal rows, their order/action results and native quote/evidence references; then the per-check completion/unavailability and physical request/phase records from the entry-to-exit windows. Decision-time migration origin, complete independently audited executed flow, actual-size quotes, modeled delay, native consideration, gas/deposit/refund accounting and exit criteria must remain missing until those exact records are available.

The owner-command export just obtained for ba33 covers **22:29:45–22:33:30 UTC**, not the 15:xx AcBX or 16:xx 8TJ1 holdings. It cannot fill these historical gaps. This follow-up did not execute the protected request or establish that the old private evidence is still retained. Current market data, candle peaks, later snapshots and matching displayed USD totals are unsuitable substitutes.

The smallest useful continuation is to complete live source93 protection and recovery verification first, then obtain the already specified bounded read-only historical records through the existing authorized protected mechanism if they are accessible. No service restart or new trading account is needed for the audit. If records were not retained, preserve the incomplete classification rather than reconstructing favorable evidence.

## Reproduction

Run the existing commands from the repository root:

```sh
python3 -m unittest discover -s test -p test_retained_paper_trade_audit.py -v
python3 scripts/audit-retained-paper-trades.py --manifest evidence/trade-quality-20261029/input-manifest.json --output /tmp/poe-retained-trade-scorecard.json
cmp evidence/trade-quality-20261029/scorecard.json /tmp/poe-retained-trade-scorecard.json
```

`historical-protection-followup.json` projects the original scorecard's exact per-run baselines, deltas and endpoint counter brackets; it does not interpolate missing checks. `reproduction-receipt.json` binds the successful rerun. No new operational acceptance or profitability claim is made.
