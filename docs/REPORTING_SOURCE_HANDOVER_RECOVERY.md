# Reporting handover and forward recovery

This is an evidence checklist for the existing original POE deployment. It
grants no deployment or financial permission and does not bind a future source
commit. `H` means the final reviewed runtime commit; `R` means the subsequent
reporting-only commit that adds exactly `H` to the reviewed handover route.
Neither symbol is an executable release pin.

## Existing deployment

The November 3, 2026 read-only review verified the existing Render service
`srv-daqon53tqb8s73bdceq0` in workspace `tea-daqk6h8jo6nc73eojtp0`, serving
`https://meme-machine-dashboard-staging.onrender.com`. Its branch is `main` and
automatic deployment is off. The observed live reporting release was
`5d13156b52b8c219f39954688f6b538c8d2120c3`; the installed runtime source was
`356083fd8f0e69297c8470d4493077a175d2bad1`.

The original account remains
`poe-3123e352-4581-455b-85db-acd7e825e99e`, inception
`2026-10-26T22:07:36.212Z`, initial USD1000. Preserve the existing
`poe-paper-10sol-v3-20261030` financial epoch, activated
`2026-10-30T19:15:05.083Z`, and its prior
`poe-paper-10sol-20261030` epoch, activated
`2026-10-30T15:30:23.584Z`. A source repair does not create another account or
repeat an epoch command.

## Before publishing the reporting handover

1. Freeze and verify `H`. In a subsequent reporting-only commit, retain every
   historical route pin, retain the old terminal source under a named route
   member, and append exactly `H` as the new terminal source. Do not substitute
   a guessed hash or require a source commit to contain its own final hash.
2. Validate old-source acceptance, valid forward acceptance, invalid-target
   refusal without identity change, and backward refusal after forward
   acceptance. Retain the original ingestion authentication and epoch,
   fingerprint, timestamp and sequence checks.
3. Retain the reporting wrapper, signed AI receiver, existing configuration,
   and both exact hashed captures used by `render-history-bootstrap.ts`.
4. Capture `/healthz`, `/api/snapshot`, `/api/ai-team`, and `/healthz` again
   immediately before redeployment. Preserve their receipt times and raw
   response bytes. Record snapshot sequence, source and generation time,
   canonical fingerprint, account/inception, epoch lineage, lifetime history
   anchors and latest point, and AI source/report timestamps and digest.

## Acceptance after reporting deployment, before runtime activation

Deploy `R` to the same service. The bound `require-receiver-readiness.mjs`
pre-activation guard must verify exact `R` on both health reads, a fresh
snapshot from the installed `356083...` source, canonical fingerprint, original
identity, PAPER/V3.1, and original epoch lineage. Automatic deployment stays
off. The guard is necessary but does not establish all continuity conditions:

- Compare snapshot sequence and generation time with the preserved pre-deploy
  evidence. They must not regress. A new process has no in-memory knowledge of
  the preceding receiver's highest sequence.
- Wait for lifetime history with durable retention, original inception and
  epoch-start anchors, preserved historical span, and a latest observation at
  least as recent as the baseline. `receiver-memory-only` is not restored
  lifetime history. Point counts may change through merging and downsampling;
  compare immutable anchors and coverage rather than exact point counts.
- Wait for signed AI reporting: `configured=true`, `state=current`, original
  account, and installed release exactly equal to the still-running old
  runtime. Preserve `generatedAt`, `sourceAt`, `receivedContentSha256` and the
  reported source hashes; reject timestamp regression. Preserve the actually
  configured supervision mode and workflows, without claiming model review or
  autonomous repair from an observation heartbeat.

The snapshot and AI caches are process memory. The EC2 lifetime equity
publisher keeps `/var/lib/poe/lifetime-equity/equity.sqlite` and republishes its
complete bounded history periodically. The independent AI publisher must also
deliver a new signed report. `/healthz` can succeed before either view is
restored. Public AI output is a receipt accepted by the exact reviewed signed
receiver contract; it does not expose a signature for independent client-side
verification.

## Acceptance after runtime activation

Run the bound guard in post-activation mode and require exact `R/H`. Repeat the
external sequence, account, epoch and lifetime checks. Require the signed AI
report's installed release to equal `H`, with both `sourceAt` and `generatedAt`
after activation. Preserve the reported status and diagnostic hashes as source
witnesses. A current AI report naming the previous source is not sufficient.
Native host process/source/configuration and financial journal continuity
proofs remain separate from receiver readiness.

## Recovery boundary

The unchanged privileged installer durably sets `possibleSourceStart=true`
before the first source/configuration image mutation. Before that boundary,
`recover_unchanged_original` can restart the old runtime only after validating
unchanged original images, supervisor, epoch and financial journal prefix.
After that boundary, `finish_known_images` and compatible-manager recovery
complete or restart the target source; they do not downgrade the source or
restore an older ledger.

| Failure stage | Reviewed recovery | Receiver requirement |
| --- | --- | --- |
| Before the new source could start | Recover the unchanged old manager with its existing financial state | `R` continues accepting the old source |
| After the new source could start | Recover forward to `H` through the unchanged installer | Keep an `H`-compatible receiver |
| Receiver process failure while `H` runs | Restart the same compatible receiver and allow publishers to restore caches | Recheck external sequence, lifetime anchors, fresh `H` snapshot and signed `H` AI status |
| Reporting regression after `H` acceptance | Use a reviewed reporting fix or reviewed `H`-compatible receiver | Do not deploy a receiver whose route ends before `H` |

A genuine accepted `H` report implies that old-manager recovery is already
forbidden by the installer. A separately requested runtime downgrade would
need its own reviewed recovery plan. Clearing the receiver's in-memory identity
or rolling reporting back to the old `5d13156...` release does not establish
runtime or financial compatibility.
