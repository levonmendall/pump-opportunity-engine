# Subscription preparation and financial readiness repair

This repair starts from the installed EC2 source
`905be6d92001351cc891d83fe11fa7b28fe98d4e` and preserves the newer dashboard,
sale-review and signed AI-reporting features from main
`4ed124f304c3f0e84fff0de82cef903b8c68f99f`.

## Corrected behavior

Candidate preparation verifies a canonical PumpSwap pool before allocating a deep
observation slot. Finalized token-creation lookup follows successful pool
preparation. The eventual observation reuses the original fresh account binding;
reuse does not renew its bank Clock, receipt time or source slot. Missing pools and
unsupported layouts remain preparation outcomes. They do not manufacture a
subscription request, acknowledgement, observation window or failed deep slot.

Existing unchanged-evidence suppression remains durable. New matching pool or
migration evidence can reopen preparation. Transient provider failures use their
own recovery timing; a failed preparation does not revoke another candidate's
healthy subscription. Discovery retains venue hints as explicitly unverified
evidence.

Subscription send time is recorded at the actual managed socket send. Reporting
distinguishes pool preparation, an actual outstanding acknowledgement, established
capture and capture loss. A continuous lack of progress survives candidate
replacement when genuinely serviceable work existed; absence of a pool or a quiet
market is not sufficient to assert an outage.

A successful cash reconciliation now remains a successful maintenance outcome
when no new operating permission is required. Financial failures and denied
permission recovery retain their separate meanings. Healthy refresh deadline
tracking no longer disarms because an already enabled account needs no grant.

Reporting collects expensive candidate summaries before the authoritative
financial sample. The existing maintainer may then perform a genuinely due cash
reconciliation, subject to its financial ownership and control gates. Original
market and valuation timestamps remain authoritative. Fixed, bounded diagnostic
fields expose actual maintenance outcomes and report phase durations.

## Reporting cost

The report queries avoid repeated evaluation of identical eligibility predicates
and reuse counts from their exact percentile populations. They still cover the
full registry and preserve null handling, nearest-rank percentiles and the
existing 64-row display page. No reporting population cap or cross-report cache
was introduced.

In a disposable 60,001-row registry, a four-sample comparison measured the mean
combined watch snapshot and backlog cost at 888.7 ms before the query changes and
607.9 ms afterward. Process CPU was 897.5 ms versus 607.0 ms. This approximately
32% reduction is an offline measurement, not proof that EC2 meets the unchanged
250 ms report target. Actual phase timing and admission measurements remain
necessary after installation.

The recorded samples are in
`evidence/subscription-readiness-20261101/reporting-cost.json`. Reproduce the
disposable benchmark with
`node --import tsx scripts/benchmark-reporting-summary.mjs`.

Report admission now reserves the larger of the performance target, the maximum
completed report duration, and the sum of fixed phase maxima, plus a 250 ms local
reserve. Both candidate scheduling and pending-action/protection checks use that
allowance. Invalid timing defers reporting; the original performance target and
financial deadlines remain unchanged. This measured estimate is not a guarantee
of the next report's execution time.

## Preserved operating boundaries

- Original PAPER account, history, positions and obligations.
- Four deep observation slots and verified 24-hour mint creation age.
- Independent audit completeness, physical request settlement and generation
  fences.
- Two-second reconciliation freshness and existing held-position protection
  deadlines.
- Existing V3.1 entry sizing and per-position cost-stop/trailing policy.
- Funded execution remains disabled.

This is a repair to the existing PumpSwap observation and PAPER execution path.
A complete pre-migration Pump bonding-curve execution adapter is a separate
capability. Persisting venue hints does not provide curve quotes, trade-event
audits, unsigned execution, or held-position migration protection.

## Verification and rollout

Focused regressions exercise pool absence without allocation, birth verification
ordering, original-timestamp reuse, provider recovery, healthy-peer isolation,
actual send-before-ACK timing, real reconciliation outcomes, report population
parity, source-bound diagnostics, dashboard behavior, sale reviews and signed AI
reporting.

The administrative release workflow runs the complete application suite on Node
24.19.0, builds a clean exact-source PAPER bundle, runs the existing 62 installer
regressions, and exercises the actual assembled package verifier. It preserves
the installer and privileged helper function bodies, configuration and backup
safeguards. The staged owner command is bound to the exact tested package.

Build success, installation, observed operating progress and a new PAPER entry
are separate acceptance outcomes. A quiet market or legitimate strategy
rejection cannot be converted into a fabricated trade to pass acceptance.

The root-owned EC2 approval for source `905be6d9` is not general permission to
install an arbitrary later release. Staging a replacement does not activate it.
The independent AI observer also does not imply that model review, billing,
sandbox execution or autonomous deployment has been activated.
