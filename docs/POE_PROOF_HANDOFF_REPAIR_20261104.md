# POE proof retention and operation timing repair

## Operating evidence

The installed predecessor is native source
`8e1f09b01f06fc01d4bcc014961f367c15ad35b4`, configuration
`f030f068a845d28f0717bf3edabe8bba0483f55cc3cc2f95a6feedb634c10d28`.
The source interval from November 4, 2026, 01:55:12.247 to 02:25:51.424 UTC
contains 64 handoffs, 43 usable economic decisions across 10 distinct mints,
and 21 expiries. All 43 decisions were strategy rejections; no trade was
forced. The 23 missing-history windows and 23 unusable audits overlap.
Four complete publications exceeded the existing 250 ms target. There were
1,633 completed cash reconciliations without a new maintenance deadline miss
or financial failure. The account was flat throughout this interval.

These are interval deltas in one source process, not lifetime totals. The
previously retained 96.345-second protection gap did not occur in this
interval. A flat interval cannot demonstrate live holding protection.

The bounded native diagnostic capture is administrator run
[41760337467](https://github.com/levonmendall/meme-machine-admin/actions/runs/41760337467).
Final bounded registry measurements are run
[41760906615](https://github.com/levonmendall/meme-machine-admin/actions/runs/41760906615),
and the final native reconciliation sample is run
[41760701025](https://github.com/levonmendall/meme-machine-admin/actions/runs/41760701025).

## Established proof defect

At 02:21:14.820 UTC, XTjj's completed proof had more than five seconds left
before its original certificate deadline. Selection then moved to SoRS,
whose economic decision completed at 02:21:16.581. On returning to XTjj,
the one-item preparation cache had discarded XTjj's reusable completed
reference. It attempted to pin the same proof identity with a later range
end. The recorder's immutable-manifest check correctly refused that changed
range, leaving the original handoff unable to proceed.

The original source and real recorder reproduce this failure offsite. The
retained live export shows the pin, peer selection and subsequent expiry;
it does not contain the second pin's internal error itself. The replay,
rather than an invented live error record, establishes that causal step.

## Repair

Keep at most four exact current certificate preparations. A selected peer
does not evict another still-valid completed proof. Reuse preserves the
original pinned range, certificate identity, completion time and deadline.
Only one asynchronous pin may run; refused work is not queued. Expiry or
generation invalidation retires an unused reference after any physical pin
settles. An unchanged terminal failure is not repeatedly retried.

The launcher checks the selected candidate's own proof. It preserves all
retained current mints during disposable registry cleanup and distinguishes
terminal proof-retention failure from pending work. An exact current
certificate with a terminal pin failure cannot keep a feasible peer waiting:
its failure remains attributed, and the next candidate competes in the
existing ranking without a new quota or economic-policy change.

Financial admission already reserved 125 ms for post-validation. Its
diagnostic previously compared work excluding that reserve with gross time
remaining. The corrected diagnostic uses the actual admission clock and
matching quantities. A peer's remaining work is unknown until that peer is
selected; another candidate's plan must not describe its feasibility.

Completed publication timing is captured after the whole report returns.
The next ordinary report carries that immutable measurement with its
original start and completion clocks. Its phase deltas belong to that same
publication. Legacy cumulative phase statistics remain separate. The
existing overrun event carries the same completed measurement.

## Missing-history routing evidence

A fixed in-memory ring retains compact identities and dispositions for
JSON-decoded notification routing. An actual missing-history audit can attach
a bounded set of matching signatures, original receipt and routing clocks,
subscription/generation coordinates, drop reasons and retention coverage.
Successful packets add no new disk record or raw payload archive. Diagnostic
absence does not prove provider loss: pre-router transport callbacks, invalid
JSON, eviction and omitted matches remain outside or explicitly limited by
the witness. Audit qualification and original audit timestamps are unchanged.

## Validation and limits

The regression suite exercises the real recorder, four retained identities,
one pending physical pin, expiry, generation replacement, failure, cleanup
and clock regression. A combined replay uses actual native candidate,
PAPER trader, quote and shared RPC admission components with an existing
holding and four slots. It verifies original proof reuse alongside audits,
reporting, reconciliation and protection. Its deliberately slow reporting
turns test competition and safety; they are not a publication performance
benchmark.

The hosted release gate must still compile and run every applicable test,
the retained-registry publication benchmark and isolated PAPER package
checks. The administrator must authenticate the exact predecessor, source,
bundle and unchanged configuration, preserve the financial and registry
prefixes, and verify the newly running process before releasing its owned
admission marker. Sustained live acceptance is a separate requirement.

No entry or exit economics, sizing rule, account, capital, trade history,
lifetime equity, four-slot scope or verified migration-age boundary is
changed. No freshness timestamp is extended. This repair does not itself
establish the cause of the remaining missing-history windows, a new live
holding-protection result, complete market coverage or a live migration
recovery beyond the first history page.
