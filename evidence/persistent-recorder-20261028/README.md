# Persistent service evidence retention

Offline verification only. This new service API does not alter the finite research `Recorder` behavior and does not claim live sustained operating success.

`BoundedRotatingRecorder` writes only a marked private versioned directory. It rotates closed diagnostic segments after at least five minutes of monotonic retention, hashes them, and records bounded chained eviction receipts. Qualification pins copy full original segments to permanent proof directories; essential execution/protection evidence is durable and never evicted. Actual filesystem pressure closes candidate admission instead of treating a cumulative evidence allowance as a healthy-service expiry. Historical evidence outside this owned namespace is never touched. Protected proof and the independent financial ledger remain subject to real disk capacity; bounded diagnostics do not promise infinite storage.

Four independent review blockers are corrected and reproduced in `exact-review-repros.txt`:

* A unique exclusive temporary checkpoint replaces the unsafe reusable truncation target. A foreign hardlinked `state.pending` keeps its original bytes.
* A Linux `flock` lease on one inherited file description refuses concurrent writers and releases after the writer process exits. `/usr/bin/flock` must exist before service cutover. The lock file is retained; it is never removed to bypass an active lease.
* Retention rechecks pin ownership after asynchronous hash validation and before the non-yielding eviction section. A proof beginning during that validation keeps every source segment until copying settles.
* Refused-record timestamps are durably recorded in bounded conservative intervals. Coalescing a receipt cannot conceal later missing evidence or make an affected proof range complete.

Restart tests now use actual subprocess exit, rather than pretending an active first writer crashed. Torn essential proof blocks new risk pending explicit verified recovery; held-position proof recording remains available when filesystem capacity permits. Old incomplete proof never becomes valid retroactively.

Reproduce from the repository root:

```sh
node --import tsx --test test/retained-recorder.test.ts
npm run build
node --import tsx evidence/persistent-recorder-20261028/review-blockers.mts
node --import tsx evidence/persistent-recorder-20261028/review-refusal-range.mts
```

Integration must check `record()` refusal, `usage().candidateAdmissionAllowed`, and `pinRange().complete`; a boolean success here does not validate market-flow completeness. Full source hashes and raw test output are retained beside this report. No service was deployed or financial account read by these tests.

## Follow-up independent review: zero-byte committed-prefix loss

The original four defects passed review, but independent crash recovery inspection found another failure in d41c287: an entire previously committed essential prefix truncated to zero bytes had no nonempty torn tail, so admission incorrectly stayed open. The original adverse reproduction is retained unmodified in `zero-prefix-before.txt`.

Recovery now distinguishes a missing or changed committed prefix from an opaque appended tail. The expected prefix byte count/hash is retained in segment metadata and receipts even when zero bytes survive. Essential prefix loss blocks new risk persistently across restarts; diagnostic prefix loss makes the old window unpinnable. Such manifests explicitly deny full essential byte preservation. Both real-subprocess-crash cases pass, with 23/23 tests and TypeScript verification in the follow-up outputs.

Reproduce the independent case with `node --import tsx evidence/persistent-recorder-20261028/review-zero-prefix.mts`. This is an offline correction; no lost real market or financial evidence is claimed recovered.
