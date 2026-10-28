# First-seal input export and actual312-book parsing measurement

The corrected forward trace identified two local pre-physical audit refusals:
238/306ms of latest-start slack was consumed by404/450ms of full baseline parsing
before physical request admission. This is local work, not demonstrated provider
latency. The lead owns the actual forward event evidence.

This narrow exporter change supports the already-reviewed quiescent checkpoint
implementation. It does not change PilotRpc scheduling, strategy, providers,
timeouts, financial state, source requirements or runtime admission rules.
No actual pilot manifest was rewritten here. No financial database or credential
was opened and no provider request was made.

For this first seal only, the actual manifest may contain exactly one explicitly
SHA-pinned anchor under `/workspace/poe-pilot/research-checkpoints/`. Its source
paths are initially UNTRUSTED candidates. Every existing native-run, whole-archive,
prepared-prefix, exact-source, physical-settlement and bounded historical-suffix
check still runs against the original raw source list. The full raw accounting
chain must match the settled receipt before the reviewed source-handoff verifier
is called. The compact runtime input is emitted only after exact source hashes,
counters, uncertainty, original429 and first-seal rolling-start history agree.

An independent review found that the existing source-handoff API alone did not
prove conservative rolling starts. The exporter now additionally derives first-
seal starts from the verified raw books at the ORIGINAL anchor.createdAt. Missing
physical timestamps remain conservatively at that seal time; known timestamps
are never moved. Repinning an anchor cannot erase/backdate demand or change its
raw-source last-observed time. This guard is intentionally at quiescent export,
not an additional per-request replay of old books.

The existing raw exporter path remains supported. The importable CLI function
has no filesystem side effects until explicitly called, allowing boundary tests
without touching the real pilot. There is no new production root/path override.

## Actual read-only benchmark

`benchmark-actual-books.mjs` read the actual settled source03 chain while preserving
all original books and the unchanged pilot manifest. It created a NEW0700/0600
private `/tmp/poe-OFFLINE-sealed-source03-*` checkpoint fixture only. The receipts
include every original book SHA, manifest/settlement SHA, actual counters and
benchmark source identity. The stronger verifier was used for the final result.

Six alternating cached Cloud file reads measured:

| Representation | Files | Bytes parsed | Median | Minimum–maximum |
| --- | ---: | ---: | ---: | ---: |
| Raw linked chain |312|20,265,906|341.84ms|322.09–429.96ms|
| Pinned first seal |1|87,512|0.96ms|0.80–1.32ms|

Both retain7464 request units,811609562 accounted bytes,421801434 observed bytes
and389808128 uncertain bytes. The private fixture retains32 unknown physical
starts conservatively at its seal time. They age through normal pacing rules;
none are refunded or cleared. The old429 remains in the accounting anchor.

These are cached Cloud parsing measurements, not EC2 or provider benchmarks.
They support removing demonstrated redundant work before an audit's physical
start. Actual EC2 audit deadline improvement still needs forward evidence.

## Verification and limits

-16 focused checks PASS:8 exporter boundaries/regressions plus8 established
 checkpoint reader/creator/physical-gate checks.
-TypeScript build PASS.
-Independent review GO for this first-seal scope; initial negative fixture
 output remains retained separately.

The first actual lead adoption must preserve the raw312 paths/books and append
its manifest transition, then freeze a new executable/input with the exact
anchor pin. A sealed anchor plus later chapters, recursive re-sealing/export,
in-process compaction, multi-day operation and24-hour acceptance are not proved
by this change. It directly enables the first bounded PAPER handoff without
turning research history into a permanent critical-path parsing cost.

Reproduce offline checks:

```bash
node --import tsx --test --test-concurrency=1 \
 test/native-input-checkpoint-handoff.test.ts test/research-checkpoint.test.ts
npm run build
```

The actual-book benchmark deliberately refuses any manifest other than the
unchanged settled raw312 source03 chain. Do not rerun it after real adoption
or remove that guard to produce a comparable-looking result.
