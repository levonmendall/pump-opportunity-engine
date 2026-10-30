# Finalized-prefix feasibility: no runtime adoption

**Decision: do not integrate cached prefixes under the current fresh independent
history contract.** Canonical ledger finality does not prove that an RPC
address-history index is complete or cannot later reveal an omitted finalized
row. Exact fresh whole-slot seam agreement cannot detect a late insertion deeper
in the cached interval. minContextSlot is not a response root/bank identity or a
common atomic history snapshot. The existing auditor already discloses trust in
the provider's bounded address-history census; caching would add a new inability
to observe later index corrections which a fresh full scan could reveal.

The read-only analysis verifies raw event/status bytes against the retained
archive index from source71896104. It contains59 completed history pages with
15,800 rows reporting finalized status. Three adjacent4Ytm chronological joins
agree with the fresh full history for32/41/42 strict-interior rows. All three
fresh scans already used one request: **zero measured requests avoided**. The
third original audit remains unusable; row-set parity cannot repair missing
source flow or manufacture qualification. There is no adjacent retained busy
rolling pair for the2,054-signature/three-page audit. No new historical or market
requests were made.

The executable synthetic counterexample has all rows finalized, an identical
whole seam slot, and a fresh scan continuing into a lower slot. Reusing the old
prefix still misses a successful row newly indexed deeper at slot130. A second
case shows why a single matching cursor is weaker than whole-slot set agreement.
An unfinalized empty-head example also prevents extending a cached frontier from
a finalized pool row100 up to a merely confirmed upper fence120.

Conditional reuse would require complete retained cursor chains and whole-slot
ranges, an actually finalized frontier, exact fresh seam membership/status,
unchanged pool/source lineage and original validation/availability timestamps,
bounded retention, and all normal source-generation/window/strategy checks.
It additionally requires an established index-completeness/no-backfill guarantee
and stable pagination, neither supplied by these responses. Independent review
agrees: GO for this evidence, NO-GO for a runtime cached-prefix certificate.

Arithmetic illustrates why a genuinely proved rolling census could help. At a
hypothetical uniform5,144 signatures/minute, a ten-second suffix plus0/13/30
seconds of additional unfinalized history needs at least859/1,973/3,431 rows,
respectively1/2/4 requests of1,000 rows. Those are projections with an existing
complete prefix, not measured response latency or provider entitlement. Six
simultaneously busy pools would still need48/84/156 physical operations/minute
including minimal ceiling/heartbeat work, before verification, retries, held
pricing or headroom. The bounded six-pool49,152-row proposal would serialize to
about9.44MB at this sample's average row size; JavaScript/index/RSS overhead and
EC2 memory compatibility were not measured. No cache was allocated or integrated.

The best existing next direction preserves fresh complete history: batch only
small first pages for quiet peers while retaining individual busy continuations.
The earlier independent live component already measured six100-row queries in
one HTTP response:136,111bytes/140ms, all six successful and physically settled
(`evidence/migration-age-20261028/history-batch-component-20261028/`). This proves
that bounded response was accepted, not future latency or quota. HTTP batching
can save physical starts and pacing time; it does not reduce logical queries,
denominator rows or billing units by assumption. A5,144-signature target still
needs at least six1,000-row pages plus its strict lower fence. Its current
four-page bound remains a real limitation. A separate source-pinned integration
must preserve the ten-second deadline, single physical gate and holding priority,
bounded responses, independent per-pool validation and truthful shared transport
failure accounting. No strategy or provider change is justified by this artifact.

Reproduce offline with the retained private capture present:

```sh
python3 evidence/native-finalized-history-feasibility-20261028/analyze.py
```

`analysis.json` retains exact event references, source hashes, arithmetic and
limitations. There were no runtime changes, financial reads, deployments or
network operations in this assessment.
