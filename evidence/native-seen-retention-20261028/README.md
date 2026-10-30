# Retired-pool transaction-cache containment

This is an offline repair of an actual source718 failure, not a corrected forward
result or production acceptance. The original five cache-related candidate gaps,
failed windows, all receipts, and the original 180-second correction horizon are
preserved.

The retained six-scope run reached the 8,192-row local notification limit for one
busy pool. Its retired transaction metadata continued occupying the global
16,384-entry full-object cache. Five other candidate scopes subsequently refused
new packets because of global cache pressure. Candidate-local overflow avoided a
source fatal, but did not isolate memory ownership.

The repair preserves at most16,384 full active transaction objects, and retains
retired exact SHA256/slot/first-availability fingerprints in a fixed1,703,936-byte
arena. Total identities are bounded at32,768; exhaustion remains an explicit
candidate quality failure. No required evidence is silently evicted, no historical
flow is synthesized, and no source timestamp or quote-validity rule changes.
Compacted records carry a six-bit mask of still-live correction obligations,
separate from parse certificates. Six matches the adapter's enforced combined
active/retiring scope bound. A scope bit is reusable only after it is cleared
from **every** retained record. Newly selected compact duplicates must be parsed
again; old pre-ACK copies remain excluded by the original first-availability
fence. Successful confirmed corrections invalidate affected live peers, including
failed→success corrections arriving through a retired subscription.

Discarding all scopes from compact packets was an unsafe retained draft: a failed
packet delivered through A and inspected against B could later become successful
through retired A without invalidating B. Reusing those obligations as parse
scopes was also unsafe because duplicate suppression could skip fresh parsing.
The separate correction mask fixes both; independent review approved this design
subject to the passing scope-reuse/atomic-refusal regressions.

`focused-tests.txt`:71 tests pass, including actual adapter failed→success through
retired and active IDs, mandatory compact reparsing, one overfull scope with five
healthy peers, the existing rebound/correction/protocol tests, full16,384 metadata
budget mechanics, fingerprint exhaustion, and scope-bit reuse within180 seconds.
`build.txt`: repository type check passes. These are offline tests only.

`replay-forward718.json` replays bookkeeping from47,067 original validated packet
records across133,231 retained event rows, with original metadata and timestamps.
The five original cache-refused packets all have admission capacity after corrected
retirement; maximum active metadata was8,398. These are **admission-only probes**
on the refused metadata. Their absent event content is not invented, and no failed
original window is promoted to a complete window. Provider delivery and runtime
behavior under a new executable still require a new forward interval.

The three `memory-*.json` files are separate cold-process synthetic microbenchmarks,
including map keys, arena and V8 overhead. At32,768 identities (16,384 retired plus
16,384 active), retained heap delta was9,537,704B versus14,398,800B for a naïve
32,768-full-object map. Measured peak process RSS was114,192,384B versus113,192,960B
for that naïve map and90,820,608B for the old16,384-full-object baseline. The compact
implementation therefore reduces retained heap, but temporary allocation/collector
behavior means this sample does **not** establish lower peak RSS. The original
whole-source374.74MiB peak under a384MiB research cap leaves little headroom;
whole-process suitability must be measured, with any resource-cap change reviewed
against actual host memory and safety reserve. Negative intermediate draft results
remain in `draft-memory-observations.json`; final results must not conceal them.

Reproduction (no provider requests or financial access):

```bash
node --import tsx --test test/native-transaction-retention.test.ts test/pilot-native-flow.test.ts
npm run build
node --import tsx evidence/native-seen-retention-20261028/replay-forward718.mjs /PRIVATE/retained/artifact/run
node --expose-gc --import tsx evidence/native-seen-retention-20261028/memory-benchmark.mjs baseline-full16384
node --expose-gc --import tsx evidence/native-seen-retention-20261028/memory-benchmark.mjs naive-full32768
node --expose-gc --import tsx evidence/native-seen-retention-20261028/memory-benchmark.mjs compact-retired16384-active16384
```

No network, account writer, provider, service, strategy or production change was
performed for these tests. An active pool can still legitimately exceed the
remaining active metadata/notification/audit limits; this repair contains retired
ownership rather than claiming unlimited high-activity capacity.
