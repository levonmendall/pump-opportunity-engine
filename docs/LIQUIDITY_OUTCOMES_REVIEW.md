# Liquidity, trade explanations, and slot efficiency

This change follows the owner's requested order: correct liquidity interpretation,
make trade outcomes explainable, remove demonstrated reporting overhead, then use
new evidence to guide later entry and exit calibration.

## What changes

### Liquidity means two separate amounts

V3.1 now compares effective curve reserves (`raw quote + signed virtual quote`)
and available real payout funds (`raw quote - retained fee buckets`). A fee sweep
can reduce the visible vault without changing either economic amount. Such an
accounting movement no longer creates an adverse entry scenario or tighter exit
protection.

The comparison preserves coherent historical snapshots and uses quote data the
engine already has. Missing historical fee buckets remain unknown. An ordinary
sell-like change can reduce quote reserves while increasing base reserves;
snapshot differences do not establish an LP withdrawal or any other cause.
Repeated reductions are explicitly conditional scenarios. Overlapping seller
and reserve stress losses use the existing maximum, not a sum.

The current full-position executable quote remains authoritative. Real economic
declines still affect stress and exit protection. Historical V3 behavior stays
unchanged; V3.1 retains its 25% cost stop and minimum trailing distance.

Protocol references:

- [Pump virtual quote reserve fee adjustment](https://github.com/pump-fun/pump-public-docs/blob/main/docs/VIRTUAL_QUOTE_RESERVES_FEE_ADJUSTMENT.md)
- [Pump signed virtual quote reserves](https://github.com/pump-fun/pump-public-docs/blob/main/docs/NEGATIVE_VIRTUAL_QUOTE_RESERVES.md)

### Each new filled trade carries its recorded explanation

The existing durable order and action records now carry a bounded, versioned
receipt. It records the entry and exit reasons, strategy, available timing
stages, selected input, observed buying evidence, liquidity, and conditional
economic balance. The existing Recent PAPER trades panel displays these facts
in an expandable explanation with plain-language descriptions of known reasons.

For a completely observed holding:

`closed trade net = exit proceeds - entry spend - entry gas - exit gas - charged failed-exit gas`

Pool fees are already embedded in quoted spend/proceeds. Failed entries,
refundable account deposits, capital contributions, and operating expenses are
separate account items. The receipt does not change the ledger's financial
calculations. Charged failed-exit fees survive restart and idempotent replay.

The receipt also reports the best recorded full-position net liquidation mark
and nonnegative giveback below that mark. Sampling can miss highs. This is not
proof of an achievable fill or foregone profit. Timing intervals describe
recorded stages and do not assign scheduling, provider, or market causation.

Historical fills retain their existing values and shape. Missing reasons,
timing, or failed-exit fee history stay unknown. Optional malformed provenance
cannot prevent an otherwise valid liquidation. Public fields use an exact
allowlist; raw provider evidence is not exposed.

The presentation cache remains at most 50 fills and 128 KiB. If explanations
reach the byte limit, only the oldest presentation rows are removed. Durable
action receipts and financial history remain retained.

### Remove measured duplicate reporting work

Each status publication previously computed the same five slot-productivity
summaries twice. It now obtains one snapshot and reuses it for both reports.
With populated metrics this reduces actual SQLite reads from 30 to 15 per
publication. Standalone readers and subsequent publications still obtain fresh
data. There is no cross-publication cache, additional provider request, timer,
registry write, scheduling change, or slot-count change.

This is a demonstrated reduction in local reporting work. Improved live
throughput or profitability has not yet been measured.

## Safe policy transition on restart

Changing the V3.1 policy changes its contract fingerprint. The 1423 source did
not recognize the original V3.1 fingerprint as a valid predecessor, which
reproduces `PILOT_STAGE_TRANSITION_BINDING` during startup. The corrected source
recognizes these two exact historical contract hashes solely for a forward
transition to the selected current V3.1 policy:

| Source | Historical contract SHA-256 |
| --- | --- |
| e5dce137, original V3.1 15% stops | c6388e70d2366a2310c7f05c5184aaa20b2b469ff746e247f39b358da8af2b7d |
| 1423b184, V3.1 25% stops | b05238659a3665a877225abccaf5775f3b1df6bc58598888d93879ed560ed271 |

They do not become active bindings or rollback targets. Unknown hashes and
forged bindings remain refused. Only an operating provenance row changes; this
does not create an epoch, alter financial controls, or grant entry permission.

The corrected policy SHA-256 is
`e44679fef5c11c4763ea670159833b9825e219b84a4e2d9e4bcc1531d933af7e`.
Its contract SHA-256 is
`9ca95a7e90e21201bcbfb926b17116d387d1da5e73e5032df04fb864fd3e8622`.

## Evidence and calibration

The inspected historical dashboard window contained 32 fill rows (16 buys and
16 sells), without the new decision receipts. A bounded display window is not
a complete ledger, and those rows alone cannot reconstruct failed-exit fees,
missing entry evidence, or timing causation. They are not a sound basis for
claiming a profitable new threshold.

The immediate entry/exit refinement is the corrected economic reserve
comparison. Future analysis can group complete receipts by entry evidence,
exit reason, holding duration, and observed timing, comparing exact net results
and explanation coverage. Report unknown histories separately. Use subsequent
trades to assess a proposed threshold change; conditional scenario balances
remain uncalibrated, and observed marks remain sampling observations.

This does not add a completed-trade count, profitability certification, daily
loss stop, or other admission gate. PAPER operation, the same account/epoch,
four deep observation slots, and the 5% maximum initial consumed allocation
remain in force.

## Verification and rollout

The integrated offline regression run passes 180 cases across liquidity,
accounting, restart compatibility, trader integration, reporting, dashboard,
execution, and slot metrics. TypeScript compilation passes. These checks prove
the stated code behavior; they are not a live deployment or profitability claim.

The dashboard validation workflow retains its complete `npm test` gate and
removes a final invocation of the nonexistent `test:pilot-reporting` script;
the pilot reporting tests already run in that complete suite.

Rollout order:

1. Deploy the compatible receiver code to the existing Render service while
   retaining the currently verified source-release pin. Old snapshots remain
   accepted. The service has auto-deploy disabled.
2. Build a clean source-pinned native package. Prepare the exact forward upgrade
   from the currently installed 1423 source, including changed publisher bytes.
3. Stage the inert package and owner approval assets. The root-owned five-verb
   gate requires owner installation of the new fixed release pins; repository
   edits do not grant that authority.
4. Apply only after those exact pins are approved. Verify source/configuration,
   same financial prefix/epoch, one writer, four slots, and current status.
5. Align the receiver's expected source-release pin only after host verification,
   then verify authenticated current-source acceptance and receipt publication.

At 2026-10-31 03:47:38 UTC, a separate admin attempt verified the existing 1423
release after an operational repair. Entries were still blocked by monitoring
availability at that instant. That concurrent repair is preserved; later host
observations determine current operating state. This document does not claim
that the new improvements have been installed.
