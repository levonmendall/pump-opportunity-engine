# Recover the existing independent measurement without replay

The Cloud collector disconnected while the original EC2 service continued
independently. The 2012 measurement remains **20:12:41.728–22:12:41.728 UTC** on
October 29. Its six first-enrollment requests all completed successfully, retaining
216,622 body bytes and five frozen leads (three active, two controls). Cumulative
provider use is 64 starts, 1,905,339 measured bytes and 262,416 historical uncertain
bytes. No first-enrollment request needs to be repeated.

The old CLI had no resume path. The explicit `--resume-checkpoint` now validates
the original plan, exact interval/runtime identity, original prior usage, six
unique enrollment pages, hashed raw bodies, re-decoded rows and frozen selection,
observation-log prefix, cumulative counters and any already captured outcomes.
Mandatory inputs use bounded regular-file reads without following symlinks.
Unsettled invocations, incomplete phases or inconsistent evidence refuse recovery
without another provider request. They are never erased or converted into a new
allowance. Completed outcomes are retained and never requested twice.

An existing live collector blocks recovery. A Linux kernel zombie is already
exited and cannot execute; actual old PID 108957 is state Z. Its FD directory is
permission-restricted, so the report records visibility unavailable and count
unknown, rather than claiming empty descriptors or requiring privileged access.
Active/unknown process states still block. A same-directory kernel flock excludes
concurrent recovered collectors. This is a research-collector lease, not a new
service or any financial writer.

Recovery archives the previous checkpoint, appends its hash, records the new
collector-source hash separately from the original plan's `b27840c…` hash, and
records the actual collector observation gap. Original plan, first cohort and
raw responses remain unchanged. The last retained collector observation was
20:36:44.300 UTC; later sampling cannot establish EC2 continuity during the gap.
The existing observation log resumes with the real maximum sampled gap visible.

The next enrollment remains **21:12:41.728 UTC**, and outcomes remain scheduled
for **22:02:41.728 UTC**. The original measurement deadline and 28-GET total bound
remain unchanged. No additional HTTP polling, Solana RPC, ledger, account,
financial control, reporting service or runtime operation is introduced.
An actual PAPER loss stop does not prevent independent market sampling and is
never cleared by this collector.

Offline verification: **32/32 focused tests and build pass**, including zero
first-enrollment replay, preserved counters/uncertainty, retained outcomes,
tamper refusal, concurrent exclusion, expiry, source changes and zombie handling.
Independent review and exact file hashes are retained beside this document.
`actual-readonly-preflight.json` preserves the initial overly strict kill-zero
result; `actual-readonly-preflight-v2.json` records the corrected kernel-state
proof and successful real checkpoint validation. Neither preflight made requests.

The reviewed recovery command, run from this isolated committed worktree, is:

```sh
node --use-env-proxy --import tsx scripts/capture-independent-two-hour-reference.ts --capture --resume-checkpoint --previous-collector-pid 108957 --directory /workspace/pump-opportunity-engine/evidence/independent-persistent-reference-20261029/measurement-2012
```

The tracked launch and subsequent request counts are recorded separately after
execution. Stopping this finite collector does not stop EC2 PAPER operation.
