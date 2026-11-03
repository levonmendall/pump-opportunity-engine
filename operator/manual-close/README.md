# One authorized PAPER close

This separate operator executable closes the single explicitly bound existing
V3.1 PAPER holding. It imports the published H2 financial and pricing code; it
does not change the native runtime, its strategy, or its flat deployment guards.
It contains no initialization, recapitalization, entry enablement, SQL writer,
signing, submission, synthetic price, or replacement-order path.

## Ownership and invocation

The reviewed root wrapper must first authenticate the original host, installed
source, account and exact holding; seal the authorization; preserve any existing
manual admission marker; perform the normal service stop; and verify the entire
old process group has exited, the original run reports physical settlement, and
the original writer lease is free. The wrapper retains the global market/watch
locks while the helper owns the unchanged ledger's normal writer lock.

Run the helper as UID988/GID982 with an empty supplementary group list:

```sh
node manual-close.mjs \
  --authorization /opt/poe/owner-actions/owner-forced-paper-close-20261103-v1/authorization.json \
  --authorization-sha256 EXTERNALLY_VERIFIED_RAW_FILE_SHA256 \
  --operating-directory /var/lib/poe/native-engine \
  --ledger /var/lib/poe/state/ledger.sqlite \
  --output-directory /var/lib/poe/native-engine/runs/native-paper-YYYYMMDDHHMMSSmmm
```

The output directory must be new; the helper creates it. The timestamp must be
between authorization issuance and invocation. Its existing parent must be a
canonical private directory owned by UID988/GID982. The authorization may be a
root-owned, group982-readable0640 regular file; all existing financial/private
files must remain private and the original ledger device/inode must match.

The authorization has exactly the fields in `ManualCloseAuthorization` in the
core module. `ledgerDevice` and `ledgerInode` are **decimal strings**.
`epochSha256` is SHA256 of the UTF-8 bytes of
`JSON.stringify(existingState.paperEpoch)`, preserving property order.
`pool` is the canonical pool in the existing native manifest's
`pools[mint].identity.pool` and `currentPoolProof.pool`. The external digest binds
the complete raw authorization file. The stable ID is consumed on the first
durable claim, even if market preparation later fails.

## Execution and recovery

Before provider work, the helper validates the original identity, unchanged
epoch, exact units/entry time/round trip, closed entries, source pins and canonical
pool. Any foreign pending action causes refusal without coordinator recovery or
cancellation. It records an exclusive private authorization claim, including
original control intent, before normal recovery or financial reservation.

The unchanged PilotMarket obtains a current full-position pool/confirmed-Clock
context and decision quote. Normal fees are5000 base plus2000 priority lamports,
and the minimum receipt is the normal100bps slippage floor. Current-model
holdings use the existing unsigned construction, observed-state execution plan,
temporary rent reserve and independently refreshed post-delay landing state.
Older holdings retain their original explicitly labeled protection model.
USD valuation may remain unavailable for a SOL exit, as in normal execution.
It cannot invent a fill when pricing, rent, source freshness or execution fails.

One normal ledger order and one normal coordinator attempt produce the durable
receipts. A completed replay returns the original receipt before any provider
read. A crash after reservation preserves the same pending exit: unchanged
startup recovery quarantines it and only normal expiry may settle it, without a
new quote or replacement. A used authorization with no order cannot retry.

Original hard pauses and stops remain hard. Valid temporary/internal recovery
lineage must remain valid after terminal settlement, and an invalid prior lineage
cannot become valid. The helper never enables entries or clears stopRequested.
The root wrapper owns the temporary admission-marker lifecycle and must remove
only its own marker after the exact successor passes readiness.

## Provider continuity and receipts

PilotRpc inherits all existing chapter/checkpoint accounting and the maximum
recorded provider/control/history cooldown. Its normal service pacing remains
90 starts/minute,20/10seconds,250ms spacing and one physical request. This one-use
composition adds finite30second,12start,32MiB bounds; these are accounting limits,
not a provider entitlement. No endpoint, retry policy or paid service is added.

Before its first provider read, the CLI appends a native-compatible run and
`unresolvedResearch` marker, explicitly labeled as the manual close. Successful
physical settlement links every resulting chapter/checkpoint and maximum
cooldown to the original operating manifest before clearing only its own marker.
An unresolved marker or failed manifest link requires the normal source recovery
path; the helper never refunds uncertain starts or declares an abort settled.

`result.json` contains the sealed authorization digest, exact source pins,
before/after account/epoch/cash/reserves/positions/pending/control summaries,
normal reservation and execution receipts, recorded round-trip outcome, control
lineage checks, provider accounting, and honest settlement/failure flags. Exit0
requires a durable filled receipt, flat inventory, physical settlement and linked
accounting. The wrapper independently verifies the historical ledger/action
prefix and unchanged original inode and epoch.

## Build and offline checks

```sh
npm exec tsc -- --noEmit
node --import tsx --test test/manual-paper-close.test.ts
node scripts/build-manual-paper-close.mjs --output-directory /tmp/poe-manual-close-output-review
```

Build requires a clean committed source tree. The pinned native dependency
plugin is reused, with only the exact one-use root-owned addon location adapted.
It verifies the published H2 source tree, nine byte-identical financial modules
against installed356083, and the exact unchanged PilotMarket exit-method ranges.
PilotMarket's whole file is honestly recorded as different because H2 also
contains entry-preparation repairs. Metadata records all source/dependency and
bundle hashes. A network-denied import smoke opens no financial account.

The offline suite uses temporary original-identity fixtures and retained real
SDK account bytes with synthetic current timing. It covers current and legacy
exits, actual-size delayed source reads, normal fees, history preservation,
wrong bindings, foreign pending work, concurrent writer refusal, durable
reservation restart/expiry, terminal replay, stale Clock, unavailable landing,
and original hard/internal control preservation. It proves local mechanisms;
it does not claim a successful live PAPER close.
