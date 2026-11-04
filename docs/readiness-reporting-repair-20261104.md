# POE recovery and publication repair

## Starting point

This change builds on application main
`fd67391848b355a404f0f5f266684e37fe64aa21`, including the installed native
source `873da573b62dcaac4f652891e2b9f4d741640d28`. The native configuration
remains `f030f068a845d28f0717bf3edabe8bba0483f55cc3cc2f95a6feedb634c10d28`.

The installed predecessor eventually recovered ordinary financial permission.
Its authenticated observation at 2026-11-04 00:38 UTC retained three distinct
actual-size quote, economic-decision, and completed-handoff sequences. Quotes
were 112, 119, and 161 ms old at decision time; the handoffs completed before
their original deadlines. All three were justified economic no-trade decisions.
This repair addresses avoidable recovery interruptions and reporting overhead;
the predecessor was not permanently unable to make decisions.

## Recovery interruption

Read-only entry layout and rent preparation holds the market continuation lock.
Independent cash maintenance can reconcile successfully during this work.
Previously, the operating-readiness controller treated every such locked-market
observation as failed financial work and cleared its accumulating technical
recovery proof. Repeated preparation could therefore delay the existing
60-second recovery interval despite healthy current financial evidence.

The market adapter now identifies only an active, original, non-aborted entry
preparation operation. An aborted or timed-out caller, an unsettled continuation,
holding work, protection yielding, and unclassified market activity do not gain
this classification. Financial permission and retirement remain unavailable
while the operation holds its lock.

The controller checks actual pending obligations, trader activity, control
authority, daily loss, evidence, financial health, admission, reconciliation,
source clocks, exact held marks, and complete inventory before classifying this
one operation as a wait. A validated wait preserves existing recovery progress;
it issues no proof, performs no resume, and advances no completion timestamp.
The next actual healthy completion still enforces the original maximum gap.

Every genuine refusal clears private recovery progress, including refusals for
which pending work or owner controls have already invalidated technical control
authority. This invalidation creates no authority and changes no financial state.

A separate live account-refresh timeout at 00:26:21 UTC was traced to the
`getMultipleAccounts` physical request and its existing one-second bound. Its
normal provider cooldown remains a real refusal. This change does not broaden
the migration-origin timeout isolation introduced by the predecessor.

## Publication work

One publication previously authenticated the same immutable epoch chain and
retained trade evidence repeatedly, reread and validated the operating history,
and projected the bounded fill rows twice. These were repeated bounded/indexed
reads, not a traversal of every financial journal row.

The financial ledger now owns a synchronous read view for one publication.
It authenticates the current state and epoch lineage, freezes that view, and
binds reusable history and trade values to that exact active view. Existing
short reporting-metadata transactions remain separate. Exact raw financial-head
bytes are checked before those writes and before returning the prepared report.
Financial mutations, nested views, and asynchronous views are refused.

Cash maintenance runs before entering the read view. The view ends before file
publication. A later report authenticates its own current financial state and
retained data again. Cached provenance cannot survive a publication or authorize
a caller-supplied object. Reusing the first fill projection preserves its count
of unresolved filled rows. Final public snapshot validation remains in place.

The publication fixture now includes actual legacy-to-V3 epoch transitions,
38 completed round trips, a populated 50-fill cache, retained operating history,
advancing report clocks, real history writes, filesystem synchronization, and
both held and flat states. This exercises the relevant retained-account read
paths; it does not reproduce the production ledger's complete disk size.

## Preserved operating contract

- PAPER only; original account, capital, financial epochs, obligations, financial
  journal, trades, and lifetime history remain authoritative.
- Four deep observation slots and liquidity-resilient momentum V3.1.
- Verified canonical PumpSwap migration age from one minute through 24 hours,
  inclusive, qualified upstream of deep observation.
- Fresh actual-size executable quotes and original decision-time provenance.
- Four-second completed holding-protection boundary, two-second target cadence,
  and two-second reconciliation freshness boundary.
- The existing 60-second technical recovery interval and minimum completion
  count; no new control waiver or permission from diagnostic observations.
- The complete-publication target remains 250 ms.
- Existing economics, equity-based sizing, provider capacity, physical request
  accounting, and external-provider restriction handling.

The release workflow runs every application regression, the reporting tests,
the full publication benchmark, and the existing isolated PAPER bundle checks
on the pinned release Node version. It includes the existing holding/four-slot
concurrent replay. Hosted validation, native activation, financial continuity,
reporting continuity, and sustained live acceptance are separate evidence gates;
this document does not assert their completion for an unpublished successor.
