# Busy-pool independent audit capacity review

Offline review of actual source63f4 run40704936322. No new RPC/provider traffic,
financial files, runtime source edits or corrected forward results. Inputs are the
verified35-file export and `forward-causal-findings.json` / the v2 retention/audit
analysis. Generation-local calculations are retained in
`audit-capacity-lower-bounds.json`.

**Decision:** repair the demonstrated control-plane failures first. A naive cache
of previous confirmed history is **not established as an equivalent optimization**.
A bounded incremental-history prototype could reduce repeated work materially,
but requires explicit contiguous slot coverage and correction/finality semantics.
The actual run never completed a multipage audit and never returned a four-page
truncation result. Do not label a projected limit as a recorded audit failure.

## Actual workload and the next capacity limit

The hottest observed scope was EzDyLqyhLBQBXGG9MDoammU79oD3dHp7mLuXC2U3pump,
connection4/subscription101416772. It delivered5,450 distinct validated signature
packets over36.915seconds of receipt time. Of these,1,200 were successful and4,250
failed transactions. These are not5,450 swaps. The current auditor still scans and
compares failed pool-address history rows; the RPC has no failure-status filter.

Its actual availability-based count peaked at1,896 per aligned10-second bucket
and2,468 per rolling10seconds. A hypothetical complete60-second target containing
all5,450 packets would require **at least6×1000-row pages**, before independent
history overfetch or fence overhead. A10-second fragment containing the rolling
peak would require **at least3pages**. These are observed-notification lower
bounds, not measured complete-history page counts: this generation disconnected
before a full60-second window and cannot supply a corrected completeness result.

Another observed generation,4VqezWppX3Nq5XLGoTZTqom7NqfMH539UFEZtN9Upump,
contained1,408 packets/33.882s, requiring at least2pages for a containing target.
HuUg connection4 had868 packets/67.859s and an observed rolling60-second peak804;
its one-page successful audit does not validate the hottest pool.

The actual source recorded7audit sessions,12physical history starts,6retained
successful page records,5verified endpoints,1late-snapshot mismatch and1physical
partial-body timeout. **All successful endpoints used one page**. Historical
counts and the timeout remain unchanged. Actual overall request peak was43/minute
and18/10seconds; the90/minute ceiling was not binding. Thus the observed forward
failure is not evidence that merely increasing the rate would repair it.

The first valid page occupied1,001ms; another occupied729ms. These include local
work and are not pure provider latency. Multipage response times at changed
request times cannot be reconstructed from these samples.

## Current algorithm's avoidable repeated work

Every completed10-second decision bucket starts a new full60-second history
walk. `NativeAuditSession` correctly yields between physical pages, but its
captured target and notifications remain immutable. The4-page limit caps one
result at4,000 history rows. Overlapping50seconds are independently retrieved
again at the next decision. One hot candidate plus quiet candidates can exhaust
this cap before exhausting average request starts.

For illustration only, replaying the observed5,450 count as a sustained workload
would make a full-window6page check every10s cost36history starts/minute for one
pool. Five one-page pools add30; coherent Clock/support and heartbeats add roughly
12, totaling78/minute before origin work, recovery and headroom. Six equally busy
pools would demand216history starts/minute plus controls; neither60nor90/minute
can serve that model. The model is not a measured six-busy-pool market interval.
A result must fit short deadlines and occupancy, not only these averages.

## Why simple history reuse is insufficient

1. Current rows are confirmed **or** finalized. A cached confirmed range can change
   through a fork or delayed history/index visibility. The current full-window
   requery can expose a disagreement that an append-only recent-tail query would
   miss. No automatic finality or stable-history guarantee is provided by an old
   `minContextSlot` request. A new native notification may expose a correction,
   but relying on that alone is circular when the history audit independently
   checks missing native observations.
2. Two adjacent strict-open slot intervals `(a,b)` and `(b,c)` both exclude slotb.
   Their union is not a complete `(a,c)` range. Composition needs independently
   observed **overlapping** fences and membership coverage for every required
   signature, not arithmetic slot padding or invented time-to-slot interpolation.
3. A source gap, reconnect, support failure, changed pool identity, correction or
   retired/reopened generation must invalidate affected certificates. Old evidence
   cannot warm a new60-second candidate window. Quiet periods are not proof of
   continuous capture.
4. Original receipt, validation, audit availability, commitment and served-node
   floor must survive reuse. Reuse must not relabel an old page with the latest
   upper `minContextSlot`, current bank context or earlier availability.
5. Late observed information must remain late. The 2BJD missing-history case was
   actually received/validated during the audit, after its snapshot and target
   close. It was retained, not silently lost. The earlier window stays unusable;
   merging that event into its earlier bucket would change the information set.

## Smallest defensible incremental prototype

Use the existing auditor/page scheduler and one bounded per-candidate proof cache,
not another provider queue or ingestion service. Each independently checked
fragment needs exact pool/identity and ACK-generation, closed availability-time
bounds, actual captured signatures/status/hash, overlapping strict slot fences,
original history coverage/commitment/floor, actual completed-at time, and gap/
correction invalidation. Retain only the current6closed buckets plus bounded
boundary overlap; do not archive or replay full downtime.

An assembled60-second result may be verified only when every target signature
has independent history membership, the union covers the required strict slot
range without boundary holes, no invalidation occurred, and all actual information
was available by the original decision deadline. Its availability is the latest
constituent completion, never the earliest one. An expired/unfinished fragment
invalidates the target and prohibits entry.

Before treating cached confirmed fragments as current evidence, choose and prove
one of: independently finalizing their entire covered range before reuse, or
revalidating mutable overlapping history sufficiently to catch corrections and
newly visible rows. Neither is presently implemented or forward-validated. Merely
waiting a guessed number of seconds is not finality. Root/finality subscriptions
or extra reads would consume actual existing-budget operations and need their own
small component proof. A correctly conservative mutable tail can reduce savings;
measure its real page demand rather than assuming sixfold savings.

Bound and measure retained signature metadata and cache size. Six hot candidates
can add many thousands of row identities on top of notification/flow state; current
run RSS already reached340,844,544bytes within a384MiB ceiling. Do not duplicate full
response payloads per overlapping fragment. Keep holdings/pending actions above
all candidate proof work. Cache reuse does not establish protection capacity.

## Narrow correction for the warming/deadline classification

Ag9's ACK14:21:39.862 preceded the first target start14:21:40 by138ms. The source
explicitly recorded no valid post-ACK/pre-target lower context or notification,
started no history request, then incremented the generic deadline counter when the
raw feature window advanced. That is initial independent-audit warming, not
established scheduler starvation. The next target was independently verified.

The smallest reporting correction is to compute independent-fence readiness for
**each raw-complete target independently of whether it was dispatched**. Record
`independent-audit-warming`/unusable coverage when the lower fence is absent; do not
consume a deadline-eligible slot. A target with valid fences but no timely dispatch
must still count as a deadline miss. Do not gate the counter solely on an opened
session, which would hide starvation before dispatch. Keep the physical-timeout
case as a real unavailable/missed evaluation, and preserve all old receipts.

Focused regression cases: ACK138ms before boundary then next valid window; genuine
fence-ready work never dispatched; partial physical timeout; same-generation gap;
late notification; and independently valid assessment in the original next bucket.
This changes diagnostic classification only, not60s qualification, commitment,
quote validity, five-second information limits, deadlines, or financial permission.

## Next measurement

After the actual control-plane repair, obtain one genuinely uninterrupted busy
candidate60-second window and retain at least one real2+page audit with exact
fences, physical timings and competing candidate service. Start with the existing
scheduler to identify whether4pages/deadline actually bind. If a complete required
range demonstrably exceeds4pages, either admit a narrower feasible workload or
prototype bounded fragments with the above proof obligations; do not declare a
truncated range complete or silently raise aggregate starts.

The incremental direction is worth a bounded prototype because repeated history
is visible and hot packet lower bounds exceed the cap. It is **not ready for adoption
as an equivalent efficiency improvement** from the available evidence.
