# Authoritative reporting latency path — read-only diagnosis

Matched original-account receipts show source→Render reported wall delays **27.500s /27.259s**, publisher ACK deltas **27.516s /27.277s**, and ACK→supervisor witness **190ms /33ms**. This does not support blaming the supervisor15s resource sampler for publication latency. Exact observations and source/input hashes are in `analysis.json`; frozen matching public receipt observations are in `matched-public-receipts.json`.

The installed025abb supervisor starts the existing independent29831 file publisher with default timing. The child reads/validates the latest source file every1s, but offers it only every15s. A second independent sender timer publishes the last offered value every15s after prior completion. `offer` does not wake that timer. Consequently a newer source file can exist while the sender retains an older offered generation. There is one in-memory latest snapshot, not an unbounded backlog.

The smallest candidate correction is to refresh that queued value whenever the existing1s inspection sees a changed verified source sequence/hash, retaining the single15s physical publication pacing, one inflight request, bounded retry/backoff, authentication and exact original timestamps. This adds no new account, service, channel or trading-provider work. It is **not implemented** and requires focused cadence/backoff/idempotence tests plus actual forward latency evidence before improvement can be claimed.

No HTTP start, offer-time, TTFB or body-duration trace is available. Cross-host reported UTC deltas are not independently synchronized network RTT. The configured5s abort is a software timer, not a measured transport bound during event-loop delay. No precise per-frame split of queued versus network time is claimed.

No network/API/provider/privateDB/credential/service/deployment or application changes were performed; only this diagnostic evidence was written.
