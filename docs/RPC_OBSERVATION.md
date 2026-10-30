# Paired public-RPC observation experiment

This bounded probe compares full canonical PumpSwap state polling with exact
account-change notifications followed by coherent reconciliation. It changes no
EC2 service, PAPER account, entry setting, provider, wallet or infrastructure.
PumpPortal remains free migration discovery; selected-token flow is still required
for qualification. Neither account data nor its changes supplies verified net
buying, participation or activity-persistence features.

Run from the new repository with the existing public network route:

```
node --use-env-proxy --import tsx scripts/rpc-observation-probe.ts
```

The probe consumes no API key and calls only public Solana mainnet read methods.
The HTTPS proxy environment, if present, supplies the existing transport route;
no credential values are printed. Default output paths are these bounded research files:
`evidence/rpc-observation-comparison.json` and its compact `.ndjson` companion.
Existing evidence is protected: a repeat run must choose a new safe output prefix, for example `evidence/rpc-observation-second`. This is not a daemon or an unattended acceptance interval.

## Predetermined comparison

One previously verified migrated pool is used: mint
`2suCpXe3HaSqCZ2Bb4dgmRrJjuDDRqwYDUTEJ3Kypump`, with retained origin evidence
in `integration-proof-2026-10-26T23-32-41.255Z.json`. Current canonical support and
an illustrative full-size sell are reverified before observation. The fixed input
is the old integration comparison quantity, not a real holding or PAPER order.
Migration age is recalculated and labeled; being within5–120minutes proves only
the age criterion, not strategy readiness.

Both paths run over the same scheduled60second window after initial WS ACKs or
a recorded handshake failure. Receipt times, original confirmed slots and block
times remain separate. Actual common-ready overlap is reported separately from
the attempted window; denied WS means zero overlapping subscription observation.

- Polling requests one fresh verified quote every7.5seconds.
- Subscriptions cover exactly the canonical pool, its two vaults, both mints,
  global config and fee config. No program/log subscriptions are opened.
- Account notifications mark state dirty. At most three extra coalesced refreshes
  are permitted, alongside15second reconciliation and one final reconciliation.
- A planned30second disconnect, if connected, must recreate all seven desired
  subscriptions and perform a new coherent verified reconciliation.
- Every pricing/reconciliation call uses the same `quotePositionSell` helper:
  current pool links, one coherent seven-account batch and its block time, then
  the pinned SDK's identity, token-behavior, fee/reserve and integer-price checks.
- A shared80request ceiling includes HTTP reads, WS subscriptions, resubscriptions
  and unsubscriptions. HTTP also shares the existing60starts/minute and one
  physical-request cap. There are no hidden per-quote RPC clients or retries.
- Notifications stop at256; account blobs are bounded512 and selected evidence
  is bounded4MB. Exceeding a limit is reported as censored capacity, not coverage.

Optional bounded verification retrieves at most two pool signatures and one
transaction when termination budget permits. It verifies only that selected
transaction's status/context. It does not classify every pool touch as a swap,
reconstruct a missing flow window or fetch a transaction per notification.

## What can be measured

The compact recorder stores each distinct canonical account once by hash (data, owner, lamports and executable; optional rentEpoch/space fields are excluded), then records
coherent batch context/hash references and individual notification account/slot/
receipt references. Original observations can be reconstructed without storing
unchanged config bytes every interval. Quote records preserve full SDK summary,
size and output; only original batch receipt can establish quote freshness.

Changed-content delivery differences require an observed content change, the same account bytes and a compatible
later poll slot. They are conditional HTTP-minus-WS receipt differences, not true
chain publication latency, independent provider coverage or swap latency. The
same RPC provider serves both paths and is not independent ground truth.
Intermediates not found by polling are not automatically lost notifications.

A notification is partial state and never an executable multi-account quote.
Its arrival does not refresh unchanged vault/config facts. The report separates
notification count from coherent verified-quote availability, and measures the
fraction of the attempted window for which completed quotes still satisfy the
2second original-receipt freshness bound. Slow cadence deliberately leaves stale
intervals; it cannot justify using stale marks for new risk or tight protection.

The two fallback cadences differ, which confounds traffic comparisons; these timings are experiment settings, not a frozen production protection policy. No equivalent-protection savings may be inferred.

No selected-token PumpPortal reference flow is funded/observed in this probe.
Three-way decision equivalence, strategy feature coverage, provider billing
savings and economic performance remain unmeasured. A quiet pool or denied WS
cannot establish reliability, lower cost per qualified decision or latency edge.
Current public RPC access has no paid key/charge, but request/byte counts are not
a verified dollar price or proof the endpoint can sustain production load.

## Actual result: 2026-10-27 UTC

The scheduled window ran00:29:08.313–00:30:08.383UTC (60.070seconds), with
58.329seconds of ACK-ready common overlap. The mint was54.955minutes after its
verified migration, satisfying only the provisional age scope. No PAPER account
or order was created.

| Measurement | Polling | Account subscriptions + reconciliation |
| --- | --- | --- |
| HTTP requests in lane |24|21|
| WS requests |0|14 (seven subscriptions on each connection)|
| Completed fresh full-size quotes |7 of8attempts|7|
| Fraction of scheduled window with a completed2second-fresh quote |22.57%|22.26%|
| Longest interval without such a quote |13.066seconds|13.244seconds|

There were65total requests:51HTTP (including setup and the optional transaction
sample) and14WS. HTTP response bytes totaled173,593; WS frames totaled24,825bytes.
These are traffic measurements, not verified cost savings. The polling/reconciliation
cadences differ and neither met continuous2second-fresh protection.

All seven subscriptions were restored after the planned reconnect. A complete
verified quote followed623ms after teardown. One polling getBlockTime request
failed with RPC-32004 (block unavailable). The second socket also closed
unexpectedly near the end, leaving an observed gap; this short probe did not test
automatic recovery from that natural failure.

The17notifications were15writes to shared global config and two to the native
SOL mint. Their selected content bytes were unchanged; no changed pool/vault
state was observed by either lane. Consequently changed-state delivery latency,
coverage and decision equivalence are unmeasured. The report deliberately
withholds the apparent receipt differences obtainable by matching unchanged bytes.

The optional successful transaction touching the pool predated the window. It
provides no in-window swap reference or participation evidence. The source file
changed after capture only to tighten evidence preservation and derived reporting;
the receipt retains the original capture digest and a labeled post-capture
analysis digest. No extra network run was used to construct those conclusions.

The measured alternatives have not passed the freshness/failure requirements
needed to replace protection. EC2 remains unchanged, entries remain disabled,
selected-token PumpPortal flow remains required for qualification, live trading
remains unavailable, and no acceptance clock was started.

The2s age threshold is an at-use quote/mark rule, not automatically a requirement
to poll continuously every2s. No production holding-check cadence or maximum
response-delay requirement was frozen by this experiment. Fresh-cache coverage
and its gaps expose the chosen schedules; absent a relevant state/exit trigger,
they cannot establish actual exit delay or decide a safe cheaper policy.
