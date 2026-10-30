# Failed-packet diagnostics no longer consume mandatory executed-flow metadata

This is a scoped repair of a newly demonstrated avoidable capacity failure, not
forward acceptance. Source9a52026's BLAyt generation reached8,192 local metadata
rows before its first complete60-second window. Of the8,192 accepted packets,
6,874 were source-reported failed and1,318 successful; its8,193rd packet was also
failed. Full failed-packet objects were consuming mandatory scope capacity even
though the adopted independent audit already distinguishes executed-flow
completeness from a full packet census.

`actual-blayt-replay.json` pins every retained source segment and the exact ACK,
transport receipt lower bound, validation and refusal timestamps. The generation
lasted45.157s from ACK to refusal. Its earliest conservative transport receipt
predated the ACK while the packet was queued; validation timestamps remain
separate. These bounds are not invented wire timestamps. The one-generation
metadata replay retains all1,318 successful rows plus at most two optional real
failed boundary anchors, and all8,193 exact global correction fingerprints
(6,875 compact failed,1,318 full). The old failure/window remains unchanged and
incomplete. There is no reconstructed later flow, successful audit or PAPER fill.

## Equivalent information reduction

Only V3 executed-flow observation applies the new policy. V2 strict packet-census
behavior remains unchanged. Clean source-reported failed interiors are tracked as
bounded diagnostics: counts, duplicate counts, first/last packets, and at most
one real fence per ten-second bucket across eight buckets. Optional pre/post
window anchors preserve their exact identity, receipt/availability/slot/hash and
subscription generation. They never displace successful metadata; when the
unchanged8,192-row audit input bound has no room, optional anchors are omitted
and the existing independently validated bank-context fences remain necessary.
No missing fence is invented.

All successful packets, including nontrades, remain mandatory. Unsupported
successful instructions and unusable/corrected packets still invalidate their
candidate. Every received packet and byte remains counted and selected evidence
continues through the original append-only record callback. This saves live
metadata and repeated array processing, **not network traffic or RPC requests**.

Global source-failed packets retain exact SHA256, slot and first availability
for the unchanged180-second correction horizon, immediately in the existing
bounded52-byte fingerprint arena. They no longer occupy full active transaction
objects. Live correction obligations remain separate from parse certificates.
Failed→success or slot/hash corrections on active or retired IDs still invalidate
affected peers; a new ACK resets only generation diagnostics. Old correction
fingerprints survive. Duplicate first availability is never relabeled fresh.

An independent history row marked successful without its actual captured executed
evidence still makes the window unusable. Missing independently failed history
rows remain explicit diagnostics, with notificationCompletenessVerified=false.
Source-reported failure alone is never an independent failure assertion. The
existing NativePaper certificate continues to require actual executed-flow
completeness, the current generation/window, feature hash and original deadline.
No safety or financial contract was relaxed.

## Verification and resource limits

`focused-tests.txt`:151 relevant tests pass, including native flow, physical
settlement/cooldown, independent audit, correction retention, NativePaper contract
and actual SDK lifecycle integration fixtures. `build.txt`:type check passes.
Independent review approved mandatory-success retention, optional fence bounds,
current-generation reset and active/retired correction handling.

Two explicitly synthetic60.001-second stress cases replay7,193 or17,000 failed
packets plus1,318 successful Sell shapes. Only program timestamps/signatures are
synthetic; integer token/SOL amounts, fee conventions and trader roles retain the
known Sell fixture. Both collect six closed buckets without a local ledger gap,
retain1,318 mandatory rows and six diagnostic fences, and remain unqualified by
independent audit. The tests do not manufacture a natural signal or trade.
Measured fixture CPU was2.66/2.84s, sampled peak process RSS217,690,112/301,858,816B
under the unchanged384MiB cap. These are accelerated offline mechanics, not
provider throughput or EC2 capacity.

The original fixture archived every synthetic record in memory, unlike the
runtime's bounded disk sink. That caused an RSS refusal in combined tests; raw
negative outputs remain in the three `*fixture*failure.txt` files. The corrected
fixture still calls/charges every source record but discards its synthetic archive
callback. The existing mock was extracted into `test/native-flow-fixture.ts` so
the high-volume test runs in its own normal Node test process. Production resource
limits and original regression assertions were not raised or weakened.

Two independent capacity blockers remain:

- Total exact fingerprints are still bounded at32,768 over180s, roughly182
  distinct signatures/s aggregate before headroom. Sustaining the17,000+1,318
  per-minute stress would exhaust that bound in about107s before expiration.
  This repair does not claim indefinite burst tolerance or silently evict keys.
- Failed transactions still consume independent pool-history pages. An8,511-row
  target needs at least nine1,000-row pages before boundaries/other history;
  the current four-page audit cannot establish its completeness. Metadata warming
  is not an audit pass. Incremental verified coverage or another justified bounded
  audit architecture remains necessary for that demand.

Reproduction, no network or financial account access:

```bash
node --import tsx --test test/native-failed-high-volume.test.ts test/native-failed-packet-diagnostics.test.ts test/native-transaction-retention.test.ts test/pilot-native-flow.test.ts test/native-flow-audit.test.ts test/native-paper-contract.test.ts test/native-paper-integration.test.ts test/native-settled-recovery.test.ts
npm run build
node --import tsx evidence/native-failed-diagnostics-20261028/replay-blayt-retention.mjs /PRIVATE/retained/artifact/run
```

A corrected source-pinned forward interval must test the live effect. No active
source, account, provider setting, production service or financial writer was
changed by this offline work.
