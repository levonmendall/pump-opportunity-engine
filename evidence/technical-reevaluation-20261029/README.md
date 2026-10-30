This is a separate, undeployed runtime repair based on
`9c552ff1edc889fd21b0492894859bfa32f937f3` (application source matching the
`cdba9d4` release). The authoritative running service, account, financial
limits, provider profile, and Render channel were not changed.

The reproduced defect was an ownership transition: after an unfilled pending
buy resolved, the watch row became `DEFERRED` while its live candidate and
subscription remained allocated. The next independent audit required a deep
watch row and could fail with `PILOT_WATCH_WINDOW_REQUIRES_DEEP` after updating
some certificate/counter state. This code defect is not attributed to the
publicly observed 8ZZ8 failed attempt; that attempt's exact cause remains
unknown without its durable financial/evidence records.

The repair keeps an uninterrupted, connected, gap-free allocation when the
existing watch allocation and subscription agree. Its old certificate and
logical audit are invalidated. A strictly later complete window and a new
independent audit are required. Existing captured data is not discarded merely
to impose another 60 seconds of warming. A missing, restarted, gapped, or
age-expired allocation instead retires normally; genuinely reactivated flow
still requires a complete new 60-second window.

Technical reevaluation uses optional metadata in the existing watch checkpoint:

- Static preparation, quote, execution-data-unavailable, and terminal-expiry
  reasons. Valid predictive, price-constraint, and financial-risk rejections
  receive no technical priority.
- At most three priority claims in five minutes, with 5/15/30-second backoff.
  Repeated failures do not renew the original expiry or consumed allowance.
- Every claim requires a strictly newer current independently audited window.
  Current proof retention, actual-size quote, strategy, and financial admission
  checks run again. The runtime records the claim in its existing entry
  checkpoint before financial preparation or reservation.
- Existing pending/uncertain actions and held positions block duplicates.
  No old order is replayed or requoted. A later qualified order receives a new
  identity; earlier charged gas and realized losses remain in the ledger.
- Restart retains consumed claims and expiry. An interrupted claim returns to
  bounded waiting, with fresh observation required; it cannot reclaim the same
  window. An exhausted/expired episode loses special priority while ordinary
  watch awareness and future baseline evaluation remain available.
- Priority changes only existing candidate selection/allocation. Existing
  pending financial work, held protection, committed audits, provider pacing,
  cooldowns, and resource admission retain priority and authority.

The tests use disposable offline ledgers and synthetic market timing. They
cover preparation failure followed by a newly audited qualification and fill,
unresolved commit ownership, expiry, charged missing-quote failure and retained
loss, distinct later order identity, restart, consumed claims, checkpoint-time
certificate expiry, continuous capture, real observation gaps, age expiry,
bounded priority, and malformed checkpoint rejection. Synthetic lifecycle
success does not establish forward trading success or profitability.

`before-continuous-ownership.txt` preserves the failing regression before the
repair. `full-tests-before-review-edges.txt` preserves the first full passing
suite before independent review identified two additional recovery edges.
`focused-final.txt`, `build.txt`, and `full-tests.txt` describe the final
verification segment. `source-before-final-tests.json` pins its exact files and
patch before execution; the final manifest verifies that they did not change
during that segment.

No deployment, real transaction, provider request, new operating account, or
service-control operation was performed for this repair. The verified code and
evidence are committed separately for review and integration.
