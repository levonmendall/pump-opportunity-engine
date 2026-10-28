# Bounded native PAPER supervision

Prepared for review and hash-pinned staging, **not dispatched**. This wrapper
runs only the existing isolated experimental account on the existing nonroot
runner. It does not initialize/reseed an account, open SQLite, read reporting
secret contents, change the original observer, install software or submit any
blockchain transaction.

The normal segment is 1,800 seconds, three deep candidate slots and the frozen
single-position PAPER contract. A fresh source snapshot must match the expected
process PID, account/inception, executable commit/hash, configuration hash and
management mode. Stopped flatness also needs that run's physical-settlement
receipt and matching zero position/pending counts. Missing/stale information is
**unknown**, never flat.

With exposure, an actual reported runway of at most4 future chapters,4 requests
or4MiB responses triggers a protected management-only handoff before the hard
book/request ceiling. Missing runway is unknown and also closes this segment.
All prior usage/cooldowns remain in the account; a new segment does not refund
consumption or change provider limits.

If exposure remains or flatness is unknown, only after the previous financial
process group actually settles, the wrapper starts one 1,800-second
`--management-only` segment with one slot. That mode cannot connect candidate
feeds or admit new exposure. The publisher remains the same independent process
across the transition. Final Render publication/drain occurs only after the last
financial segment; it cannot delay recovery of open positions. Cross-segment
protection timing uses previous last completed check to recovery's first
completed check, or remains unknown if those facts are unavailable.

This is a finite first operating experiment, not continuous 24-hour hosting.
If exposure remains after the recovery ceiling, the outcome is non-success and
records the monitoring interruption and unresolved state. It never fabricates a
liquidation. Follow-up management must preserve that ledger and its obligations;
the old observer is not a management rollback target.

The existing reviewed publisher and dedicated secret file are reused. Publisher
watch-process restarts are bounded to two; its internal retry/backoff remains
independent of financial work. If the first accepted current-run source timestamp is not verified within
55 seconds (the minimum60-second candidate window minus5 seconds of margin), or
after90 seconds without an accepted **current-run source timestamp**, the supervisor writes a private, append-only
`admission-suspension.request`. The runtime closes candidate/new-risk admission
while continuing held/pending work. An ACK heartbeat cannot freshen an old source
timestamp, and the wrapper never automatically removes the marker. Reporting
failure is measured separately from financial settlement.

The supervisor observes up to four exact recent status byte strings, bounded
at16MiB in memory. It matches publisher acknowledgements by the already-verified
account, run, source timestamp and running flag, then privately retains the
first two successfully matched source payloads and the latest two. First slots
are immutable; latest slots are explicitly rotating diagnostic caches. Each
retained source has its SHA256, original bytes and actual publisher ACK in the
witness receipt. A missing raw payload remains an unmatched acknowledgement;
no snapshot is reconstructed. Storage pressure or a capture fault disables only
this evidence cache and is reported separately, preserving financial work.
Witness writes remain within the shared32MiB supervisor-evidence ceiling.

## Bounds and prerequisites

- Existing UID994 runner and exact EC2 identity, original observer identity/PID/
  restart checks before and after; no original-service mutations.
- First segment requires 1GiB available RAM and disk. Management recovery requires
  512MiB available RAM and 256MiB disk. Ongoing disk low-water:128MiB; MemAvailable low-water:256MiB. ParentRSS128MiB.
- Source:192MiB Node heap,512MiB combined source/worker RSS, CPU220s early graceful
  stop,240s soft/245s hard CPU. Source per-file ceiling40MiB permits the existing
  financial DB and16MiB backup contract; stdout is separately watched at8MiB.
  The runtime's earlier160s new-entry and180s candidate-processing boundaries
  leave40 CPU seconds before the supervisor's protected handoff. These local
  resource margins do not guarantee timely exits through an RPC outage.
- Publisher:128MiB RSS,30s soft/35s hard CPU per process,1MiB log ceiling. Parent
  and children use clean environments; reporting secret goes only to the
  already-reviewed reporting launcher via a fixed file path.
- Outer:3,840 seconds including setup, both segments, cleanup and one final
  publication; workflow66 minutes. Child process groups use parent-death kill and
  are settled before any new financial writer. No financial evidence is uploaded
  by the workflow; detailed logs/receipts stay private on the existing host.
- Initial interval completion requires the actual normal source span to reach
  1,795 seconds, normal zero exit, no supervisor interruption, final flatness,
  accepted stopped report and unchanged original observer identity. This is
  mechanical bounded completion, **not operational/profitability acceptance**.

The installed private code release and same-account import are prerequisites.
This wrapper neither imports an account nor stages the code release. Those
separate helpers must have completed their hash/identity/recovery checks first.

## Same-account executable upgrades

After the installed new main executable matches the reviewed run manifest, the
same supervisor can resume the already imported account with a new source. It
does not re-import, initialize, reseed or read SQLite. If `input.source` differs,
it first acquires the existing financial-owner flock and verifies the fixed
account/inception, a settled manifest without `unresolvedResearch`, stopped PAPER
status matching the previous input source, absence of the prior runtime PID,
and that exact prior run's physical-settlement receipt and ownership counts.
Settled open positions and pending actions are preserved; they are not required
to be flat. Unknown, active, conflicting or unsettled state refuses the update.

Under that lease it privately retains the exact original input plus an
append-only plan, then atomically changes only the input's source commit/hash.
A successful transition adds a receipt with old/new sources and input hashes,
the prior stopped timestamp and the actual gap at transition. Old status, market
evidence, manifests and every financial file remain unchanged. Interrupted plans,
backups or temporary replacements are retained; an existing operation directory
is refused rather than overwritten. The runtime must then acquire its ordinary
sole-writer lease and perform its established financial recovery. This is a new
versioned segment, never uninterrupted operation or a24-hour acceptance claim.

## Manifest and commands

Place a reviewed `operator/native-paper-ec2/run-package.json` in the existing
administration checkout and replace both workflow hash placeholders. No mutable
branch lookup occurs while publishing status. The exact manifest keys are:

```json
{
  "schemaVersion": 1,
  "kind": "poe-native-paper-bounded-supervision-v1",
  "source": {"commit": "40_HEX", "sha256": "64_HEX_MAIN_BUNDLE"},
  "configurationSha256": "64_HEX_NORMAL_CONFIG",
  "managementConfigurationSha256": "64_HEX_MANAGEMENT_CONFIG",
  "nodeSelectorSha256": "64_HEX_REVIEWED_EXISTING_HELPER",
  "publisher": [
    {"path": "run-publisher.sh", "bytes": 1, "sha256": "64_HEX"},
    {"path": "dist/publisher.mjs", "bytes": 1, "sha256": "64_HEX"},
    {"path": "dist/manifest.json", "bytes": 1, "sha256": "64_HEX"}
  ],
  "limits": "COPY_EXACT_LIMITS_OBJECT_FROM_REVIEWED_HELPER"
}
```

Use actual bytes/hashes, not these placeholders. Compute both config hashes by
importing the final standalone bundle and calling
`nativePaperConfigurationSha256({stage:'single',deepSlots:3,durationMs:1800000,managementOnly:false})`
and the same function with `deepSlots:1,managementOnly:true`.

Root coordinates the existing administration workflow, exact private imported
account and read-only public dashboard sampling. The runtime start command is:

```bash
node --max-old-space-size=192 /PRIVATE/RELEASE/native-paper.mjs \
  --resume --directory /home/mm-ec2-runner/.local/share/poe-native-paper/account \
  --input /home/mm-ec2-runner/.local/share/poe-native-paper/account/input.json \
  --paper-contract confirmed-program-ordinary-flow-paper-v1 \
  --stage single --deep-slots 3 --duration-seconds 1800
```

The wrapper chooses management-only recovery; it never creates a second account.
Actual runtime file/financial data are not present in this repository template.

Offline checks:

```bash
python3 -B operator/native-paper-ec2/test-run-bounded.py
```

The tests use synthetic status/receipt metadata and disposable real child
processes. They verify cancellation/reaping, clean environments, restricted-parent
resource compatibility, source/PID/account/freshness checks, unknown-not-flat,
private safety-marker preservation and a same-publisher financial handoff with
no Render wait. They are not EC2 measurements or natural PAPER trades.
