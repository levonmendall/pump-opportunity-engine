# Bounded research-accounting checkpoint

This is an offline research-counter implementation, not a financial ledger, provider allowance, authorization system, automatic continuous supervisor or natural-market performance result. No real pilot manifest, ledger, provider endpoint, wallet, original observer or Render configuration was accessed or changed.

The append-all old start arrays and raw chapter paths eventually exceed the existing 512-path/32MiB aggregate/512KiB-per-book guards. The repair seals a quiescent, independently settled **explicit** chain into one new private checkpoint. Every historical book, receipt and prior checkpoint remains. Its source list retains ordered paths, whole-file hashes, byte sizes and contribution totals; its previous-checkpoint reference preserves ancestry. It carries exact cumulative calls, observed bytes, uncertain reserved bytes, pending count, original HTTP429 refusal and final chapter halt. Operation IDs continue from cumulative calls. No uncertainty, consumed units or bytes are refunded.

Only starts relevant to future sixty-second provider windows are retained in the new active baseline, with an explicit omitted-count/fence marker. Recorded physical starts retain their exact timestamps. A missing physical timestamp is conservatively assigned the independently verified settlement/seal time, and reported as an estimate—not the earlier reservation or `lastObservedAt`. Independent review caught that a crash may occur after transport invocation but before its stamp is persisted; the intermediate `lastObservedAt` implementation was repaired. Prior checkpoint estimates age at their original fixed timestamps and are never repeatedly retimed.

Startup requires the checkpoint SHA256 explicitly pinned in `baselineCheckpointSha256` in the existing manifest/public input; a checkpoint without that matching pin fails closed. Strict private-owner/single-link/size/schema/counter/fence checks apply. Following ordinary ComponentBudget chapters retain exact baseline/hash/start-history linking. Legacy chains keep their original validation and defaults. Default32 paths, 512KiB per file,32MiB total active input and provider pacing limits are unchanged.

`createResearchBaselineCheckpoint` writes one exclusive0600 file, fsyncs it and its parent, never overwrites an existing path, and returns the proposed path/hash pair. Failed partial output is preserved rather than silently replaced. The caller must own existing research leases, verify physical/process/transport settlement and retain provider cooldowns. The supplied settlement fields are checks of that caller-owned evidence; they do not independently prove an external process stopped.

## Adoption and remaining integration

The reader, PilotRpc, native candidate input, existing pilot manifest/runtime, native PAPER launcher and stager accept the optional pinned anchor. Creation/adoption is **not automatic**, and no actual pilot manifest was compacted.

Before replacing a settled raw path list, preserve the prior manifest/anchor SHA and all original settlement receipts. `verifyResearchCheckpointSourceHandoff` proves the proposed seal's exact ordered source hashes/contributions/cumulative counters match the independently verified native+supplemental chain. The existing public-input exporter's receipt/source/accounting guards must remain; its new compacted-handoff branch still needs to be wired against the lead's newer supplementary historical runs before actual adoption. This branch deliberately leaves that exporter unchanged. Never simply delete the raw-path-equality guard.

Quiescent seals solve repeated bounded-segment history growth. They do not implement automatic in-process closed-prefix rollover while continuous capture remains open, or establish uninterrupted24-hour operation. Those are separate runtime integration/evidence requirements.

## Verification

`focused-verified.txt`:51/51 focused tests pass, including eight new checkpoint scenarios, legacy reader/budget tests, input/launch guards and a mocked PilotRpc operation plus same-anchor restart. `build-verified.txt`:TypeScript build passes. No full-suite run was duplicated while the lead owned full verification.

The 72 synthetic24-hour clock jumps verify cumulative accounting and bounded active history across rollovers; they are not72 days of real runtime evidence. Tests preserve unknown-byte debits, operation IDs, old429 state/cooldown receipt requirements,90-start/minute pressure, missing-stamp crash timing, in-flight refusal, file/schema/hash mutation, exact raw-source handoff and legacy path limits. The only mocked HTTP operation uses an in-memory `fetcher`; no external request is made.

Adverse intermediate outputs are retained. `base-cap-fixture-failure.txt` includes the already-known c1fc938 ancestor's stale224-path cap expectation (fixed independently by the lead); `mock-envelope-fixture-failure.txt` exposed a test response returning ID1 instead of the actual continued ID3, fixed in the fixture. Neither is reported as a forward provider failure.
