# PumpSwap operating scope

The persistent V3.1 PAPER service commits candidate resources only after an
observed PumpSwap venue or migration hint. The original account, four deep
observation slots, finalized creation-age limit of 24 hours, V3.1 economics,
actual-size executable quote requirements and financial permission checks remain.

## Admission and resource use

The PumpPortal connection subscribes to migration events only. It does not
subscribe to new Pump.fun tokens. PumpAPI's shared stream still delivers traffic
from multiple venues; the feed discards other venues before token-specific
processing or durable intake. Its parsed venue must be `pump-amm`. The runner
repeats that admission check before handing identities or activity to the intake
worker. The provider documents client filtering at <https://pumpapi.io/stream>.

Migration and venue messages are routing hints, not proof that a tradable pool
exists. A bounded canonical pool validation must establish the actual supported
PumpSwap account state before creation-history work or deep allocation. A missing
or unsupported pool never triggers a creation-history lookup. The shared feed's
unwanted network bytes are still received and cheaply discarded; this policy
does not claim zero transport traffic from other venues.

Historical registry rows and financial history are retained. Existing migration,
explicit PumpSwap venue and validated-pool evidence initializes a small indexed
routing set. A canonical pool address derived from a launch alone is insufficient
to schedule a historical pre-migration token.

## Creation-age evidence after migration

The service first uses a retained birth signature if one exists. Otherwise, after
pool validation, it searches finalized mint-signature history cooperatively: one
page per admitted discretionary turn, with only a cursor and candidate signature
retained. Waiting mints take turns; newer arrivals cannot indefinitely overtake
an older waiting cursor. Available age-ready pool preparation also receives a
turn between history pages. Native service, audits and financial work retain
their existing priority and request budgets.

History identifies a transaction to inspect, not a token birthday. The unchanged
strict decoder must independently verify finalized Pump `create` or `create_v2`
and the child SPL mint initialization. An earlier funding transfer is rejected
as a birth proof and the search advances to the next candidate. Stale responses
cannot overwrite that progress or an established immutable creation proof.
Solana documents the address-reference and pagination semantics at
<https://solana.com/docs/rpc/http/getsignaturesforaddress>.

History acquisition is limited to the existing 24-hour horizon. An older address
reference or incomplete provider history leaves age unavailable; it does not
fabricate a creation timestamp. Missing verified age continues to block deep
allocation and entry.

## Timely decisions and diagnosis

The audit scheduler services the obligation whose hard deadline limits the
pending audit, using that obligation's RPC or control gate. After an audited
candidate passes preliminary evaluation, bounded proof retention starts in the
audit callback and is reused by the ranked financial handoff. The original
certificate identity, expiry and durability-before-order requirements still apply.

A final quote can lose admission after shared pacing brings an existing native
service deadline too close. After that specific local refusal, with no unsettled
physical request, the launcher may service one already-required native obligation
and retry the quote once. It rechecks the exact original certificate, current
financial permission, protection runway and pacing deadline. Maintenance uses
its own single-start scope while consuming the unchanged global provider budget;
the flat four-start or held nine-start entry envelope is unchanged. Reserved or
accounted starts are never refunded, and insufficient remaining runway or budget
still refuses the quote. Provider failures do not trigger this retry.

Raw status includes `financialReadiness.monitoringAdmissionReason`, the first
failed existing financial-capacity prerequisite. This diagnostic does not grant
permission. The intentionally disabled creation feed is separately marked
`enabled:false`; it is not a monitoring outage.

An empty deep slot is an observation of utilization. It establishes a missed
opportunity only when an eligible, serviceable candidate was actually available.
Audit deadline and missing-history failure counts can overlap and must not be
added together as a count of unique failed windows.
