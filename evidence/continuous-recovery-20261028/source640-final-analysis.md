# Source640 final streamed analysis

Source `640143a5924a7ff7d98039967c2db17957f71f24`, configuration `29d9de0d148c52a10ebad22eb66875636fa06beacbe66004862cd8f0505597bf`, ran 15:17:11.944–15:53:14.173 UTC on 2026-10-28 (2162.229 seconds to stop request). This is a useful high-volume native-data milestone, **not reliable concurrent-operation acceptance**. The final archive was supplied as131hash-verified files. This review streamed13event files; exact input hashes, record locations and calculations are in `source640-final-analysis.json`. No market requests, runtime changes or financial writes were made.

## Actual workload and independent coverage

There were39unique acknowledged mints and129ACKs. Counting only acknowledged scopes, with logical candidate retirement or matching disconnect ending each scope, six simultaneous scopes existed for1190.053seconds cumulatively, with84.862seconds the longest uninterrupted six-scope segment. Six allocated but not yet acknowledged candidates do not count. This establishes actual six-way observation, with substantial gaps/restarts; it does not establish six busy pools or continuous reliability.

There were27,113ordinary information-availability packet records (27,110distinct signatures across scopes):13,213successful and13,900failed. They yielded7817ordinary normalized trade events. **43protocol-pool effects are separate**, not43extra external buys or ordinary trades. The final native notification count27118 also includes4unusable refusals and1correction;346additional bound notifications were ignored after gaps and remain disclosed.

Aggregate peaks were2419packet records in a rolling10seconds and7884in60seconds. Fhs alone produced7259records in60seconds (peak2354/10seconds); D9NX produced3909/60seconds. These are scoped packet counts, including failures, not strategy-qualified trade rates. Receipt-to-validated-information delay was p50=885ms, p95=1998ms, maximum4207ms. Receipt is the recorded conservative transport-batch time, not exact wire arrival.

The run produced13independently verified60second **shadow** predictive assessments on11unique mints; all13failed persistent-buying, none passed. Overlapping windows are not independent market minutes. It also recorded55lower-fence warming windows,21decision deadline misses,24unavailable audits and2unusable audits. No financial writer was opened; entries, orders, positions, closes and trading P&L were unavailable, not failed executions.

History retrieval returned18,355rows across19physical-page records for496interior rows represented in completed diagnostics. Most audit failures were23physical timeouts;1captured-target-not-in-history remained unavailable. Busy Fhs received3pages/3000rows, then its4threquest timed out without covering its lower fence (`events-006.ndjson:7096`). This is **not an observed four-page-capacity refusal**, nor successful multipage completeness.

## The two unusable audits

All6supposedly missing history rows were independently **successful**, not failed packets. Executed-only failed-row handling cannot repair these two results.

- **mWT**, target15:25:50–15:26:50, audit frozen snapshot/start15:26:51.859, completion15:26:52.797 (`events-004.ndjson:2`). Its3missing packets actually validated at15:26:52.263,52.275 and52.705, after snapshot but **before audit completion**. Their original availability remains after target end; they cannot become earlier feature input. This demonstrates stale frozen audit-input context, not permanent loss of these packets.
- **vvJ**, target15:44:00–15:45:00, snapshot/start15:45:04.947, completion15:45:05.615 (`events-011.ndjson:5325`). Two missing packets validated at15:45:04.970 and05.149 before completion: one ordinary Buy and one protocol boost effect, with correct separate semantics. The third successful signature `4ibMkh4H6PGYvtBuRjuzRm8KCKtp167Jbxcss6BgRGPdWZ54BcqUQ6FXfNjqaj8MmyuUVAq4QL8wS5Laa4iaTUhk` has **no matching retained native packet**. Its history blockTime15:45:03 is after target end, but blockTime cannot establish local availability or excuse missing successful evidence. It must remain unusable/unknown without new evidence.

A safe narrow repair may refresh actual post-snapshot diagnostic tail packets when completing the audit, while preserving the original required target list, original60second features, actual availability, generation, strict slot fences, corrections and all deadlines. It must not backdate the tail, waive the unknown successful signature, or call every interior history row an original-window trade.

## Final source-wide stop

The recorded precursor is a **timeout/cancellation/late-ACK race** on connection19:

1. ACKs at15:53:10.918,11.465,11.790 and12.086.
2. Fifth `logsSubscribe`, physical operation5681, starts12.400.
3. Its1500ms timeout fires14.085 (1685.428ms actual elapsed; callback logged14.103).
4. Six candidates retire14.119.
5. Late numeric ACK101851025 arrives14.127, refused `NATIVE_FLOW_CONTROL_CANCELLED`: no registered candidate, cancelled, transport closing, no active/retired-ID match.
6. Physical operation settles14.158; disconnect14.159; source stop14.173 with `NATIVE_FLOW_UNSCOPED_NOTIFICATION`.

Evidence: `events-012.ndjson:6736–6809`, `events-013.ndjson:1–8`. The actual offending unscoped packet/subscription ID was not retained. There was no connection19subscription-retirement record. We therefore cannot identify the fatal packet as101851025, attribute it to retired-ID TTL expiry, or claim the8packet early-buffer overflow occurred. These remain source-level possibilities, not measured causes.

## Provider and resources

All648physical starts have648settlement records. There were48physical-timeout records. Peak demand reached52starts/minute and20/10seconds; the90/minute research ceiling was not saturated. All317recorded HTTP header statuses were200; this does not establish provider saturation or successful bodies for timed-out operations. Timeout-induced cooldowns caused84candidate gap records. A local/provider/processing contribution cannot be separated from these measurements alone.

Peak RSS was378,204,160bytes (360.68MiB) against384MiB cap. Event-loop p95 was32.70ms, maximum1183.84ms; therefore processing/callback lateness is material and90/minute cannot be treated as entitlement. Cumulative run CPU was370.655seconds over2162.229seconds elapsed (~17.1%one-core average), not a CPU-capacity guarantee. Feed usage was65,825,081native bytes,2,223,701,237broad-watch bytes and4981discovery bytes. RPC accounted response increment175,593,198bytes includes retained uncertainty; it is not all measured body traffic. Existing compute/transfer charges remain separate and unverified.

The current useful gains are real high-rate native retention and11independently assessed unique candidates. Remaining known limitations are source-wide cancellation-race failure, stale frozen audit-tail context, unknown successful activity, timeout/recovery gaps, one1500ms physical profile with significant loop stalls, and no demonstrated high-rate complete multi-page audit. These prevent declaring high-activity simultaneous operation reliable. No production or PAPER financial acceptance follows from this result.
