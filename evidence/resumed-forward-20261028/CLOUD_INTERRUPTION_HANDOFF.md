# Cloud interruption handoff — 2026-10-28

The execution environment became unavailable during final combined offline verification.
No new forward measurement was active. Do not restart from an old source or rerun a
historical measurement. Recover the existing workspace and local commits first.

## Exact state

- Last known LOCAL lead HEAD: `640143a` on `poe-free-data-evaluation-20261027`.
  Obtain the full SHA from local Git after reconnect. Local commits after published
  `0dc3d44` have NOT been confirmed pushed. This remote handoff does not back up
  those local Git objects or their full raw evidence.
- Last fully verified combined source:
  `472f707da84a63c8fbb3d535600f5fc7e6c5cb87`.
  1,218 tests, build, compile, and 39 packaging checks passed by 14:59:13 UTC.
  Raw logs/identity/hash receipts: `evidence/resumed-verification-20261028/472f707/`.
- Final verification at local `640143a` was still unresolved at interruption:
  `evidence/resumed-verification-20261028/640143a/`, prior tool session43341.
  Do not infer its outcome from the earlier pass. Inspect raw log and receipts first.
- Local main tracked dirty file remains unrelated `docs/FUNDING.md`; preserve it,
  `operator/funding/`, all financial records, old locks and evidence.
- No new executable was frozen/staged/dispatched after the first failed resumed run.

## Actual forward evidence

Existing admin commit `4ee813c89b18a93bffea4f20b5eba9d5826c4b18`;
GH run40704936322, job122874390126;
source `63f4ac439c6b22c7d532c284890cf47e78ad5d62`;
run `native-candidates-20261028142028669`.
Executable SHA256:
`130b02f614b46b3576e1659cf2f0a18ce8f56e288b76578d05bd23398d920dd0`.
Configuration:
`29d9de0d148c52a10ebad22eb66875636fa06beacbe66004862cd8f0505597bf`.

Actual 14:20:28.669–14:27:42.292 UTC, 433.623 seconds of planned two hours.
FAILED on `NATIVE_RESEARCH_UNMANAGED_CONTROL_REQUIRES_ACCOUNTING`.
The source stopped itself; a later cancellation request was refused because it
was already complete. Do not describe this as an operator-controlled stop.

- 15 unique allocated tokens, maximum6 ACKed scopes; six scopes existed54.583s total.
- 1,766 ordinary normalized trades,27 separately represented protocol effects.
- Five independently audited assessments on five tokens:4failed/1shadow non-rejection.
- No executable qualifications, PAPER orders, fills, positions, exits, P&L or financial writer.
- 31qualitygaps:19cascadefrom4subscription-control failures,6finaldisconnect,
  5unsupported base-burn frames,1late audit-snapshot mismatch.
- Two recorded deadline events: one was initial missing lower-fence warming,
  one a real partial HTTP-body timeout. Preserve original counters.
- Hottest scope5,450 distinct notices/36.915s exceeded old4096 but remained below8192.
  No natural compaction/overflow-containment proof and NO multipage live audit pass.
- Peak43starts/minute and18/10s;90/minute research ceiling was not binding.
  Source CPU81.171877s, maxRSS340844544B, loopmax847.249ms.
- HuUg shadow non-rejection occurred at verified migration age3.625533min,
  with520trades/247buyers/net1.653035105SOL. Strict-v2 baseline was unavailable
  due protocol effects. No actual-size paired quotes or economic result was collected.

Application and owned process groups settled. All207 managed physical starts matched
settlements. One actual automatic protocol close frame was separately appended,
with its original time and64KiB uncertainty; no refund/fabricated network start.

Whole archive6,693,572B SHA256
`94d60ed5e11a88e61eaae7c571c833285abfc09f0d304ec7c8026963873e6fc9`;
all35 indexed files verified. Durable host raw/archive path:
`/home/mm-ec2-runner/.local/share/poe-native-research/poe-native-candidates-40704936322-1`.
No GitHub artifact uploaded or host evidence deleted.
Readback jobs40706469436/40706554963 succeeded through existing admin route.

Local evidence:
`evidence/resumed-forward-20261028/`;
private complete artifact:
`/workspace/poe-pilot/runs/native-retention-20261028142017/artifact/`.

## Implemented post-failure repairs — not yet forward validated

Integrated local lead commits:
- `880512f`: PaperTrader audit-readiness bucket repair; unavailable evidence no
  longer consumes the bucket before a same-bucket valid audit; financial checks intact.
- `0aec639` (isolated84cae65): suppress unadmitted automatic ws control frames
  BEFORE sending; preserve disconnect/backoff; connection-bind managed controls.
  Adds bounded inner ACK refusal diagnostics to distinguish unknown cascade cause.
- `7609729` (isolated7d0aa88) plus `fbb448f`: exact classic-token protocol burn
  shape only with fresh validated mint-owner binding, wired from SDK support summary.
  Protocol effects remain nonfinancial and are never ordinary buyers.
- `13dc28b` (isolatedc06bcfd): lower-fence warming classified separately;
  genuinely fence-ready starvation and physical timeouts still count as failures.
- `d32056d` (isolatededdffe2): scalar retention/compaction/pressure totals survive
  candidate retirement. No validation, scheduling or capacity change.

All except final metrics delta were jointly verified at472f707.
Metrics delta had70focused tests/build in isolation; final combined640143a outcome
is unresolved. Preserve the failing fixtures and independent review records.

Do not cherry-pick these twice: they are already in the LOCAL lead history.
Relevant isolated worktrees retain original commits:
`poe-native-control-accounting-20261028`,
`poe-classic-protocol-burn`, `poe-audit-fence-classification-20261028`,
`poe-native-paper-interop`.

## Accounting and next input

`/workspace/poe-pilot/pilot.json`:138linked books,5033accounted units,
209285767accounted response bytes,53477376uncertain bytes.
Unresolved-research marker was cleared only after actual settlement/hash checks.
Keep all history. Old lifetime240-unit cap is superseded.

Use latest actual run WATCH (144rows) and119 paired origin proofs, not the older
132-row listener checkpoint. Original three hints remain historical unverified
observations; never infer migration time from receipt time or reinsert stale hints.

Existing exporter now supports:
`--handoff-directory /workspace/poe-pilot/runs/native-retention-20261028142017/artifact/run`
and
`--settlement-receipt /workspace/poe-pilot/runs/native-retention-20261028142017/settlement-link.json`.
It checks exact chain, source/config/identity, whole archive and current proofs.
Review current process/lease state after reconnect; historicalPID6822 is not proof
of current ownership. Do not automatically resume old processes.

## Reporting and production

Two exact actual running source snapshots matched public Render counters, decisions,
identity and timestamps. At15:01:22UTC stopped projection matched exactly; source
stale/disconnected was explicit; unauthorizedPOST401 andhealth200. Original public
account/inception/release unchanged with progress15:01:08.675UTC.
Original observer direct host check14:27:43UTC activePID2333724/NRestarts0.
No observer/service replacement or production financial change occurred.

Existing Free Render remains reporting4c6752d/dep-dbgpb3k9v7es73b2m5lg.
No new Render deployment this resumed session.
Finite public sampler was stopped; independent eight-token index sample stopped
after source end. Six index calls/215223B, no outcomes or whole-market recall.

## Next exact action

Restore access to the EXISTING workspace, inspect local640143a verification receipts
and running processes, preserve/push all local commits and raw evidence, reconcile
this remote checkpoint without force-pushing concurrent work, then freeze the
corrected executable/configuration and conduct the next purposeful bounded six-slot
candidate interval. Inspect new ACK diagnostics for the unexplained control cascades.
Do not repeat the failed source hoping for a favorable sample.

Only after observation readiness: integrate native audit certificate/slot floors
with existing PAPER execution, SDK pricing, ledger/recovery and holding-priority
scheduler. Currentv3-shadow remains financially ineligible. No24hacceptance clock.

No real signing, chain simulation/submission, wallet funding, paid commitment,
account reseed or live trading. No new financial approval or wallet is required
for the next authorized research step; execution-environment availability is the
immediate external blocker.
