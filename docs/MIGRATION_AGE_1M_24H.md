# PumpSwap migration-age admission

Owner-approved market scope: verified canonical PumpSwap migration age from 60,000 through 86,400,000 milliseconds, both boundaries inclusive. Mint-creation time, discovery time and refreshed pool/activity time cannot substitute for the migration timestamp.

The upstream qualifier obtains and retains the migration proof. Deep slots carry an immutable eligibility/expiry interval and use a local clock comparison, with no age-history requests. Mint-creation transaction lookup is not an active dependency of persistent V3.1 admission. Missing migration proof defers that candidate only.

PumpSwap-only scope, four observation slots, V3.1 economics, actual-size executable prices, source/audit freshness and PAPER-only execution remain unchanged. Existing holdings keep their exit policy after age expiry. Financial account and history are not reset.

The dashboard current-UTC-hour count measures newly admitted registry identities, not all on-chain launches. Runtime diagnostics separately identify migration verification pending/eligible counts.

## Resumable upstream recovery

A shared PumpSwap swap may identify the canonical SOL pool without carrying its
original migration. The qualifier follows that pool's signature history in
1,000-row pages. A full page advances a durable exclusive cursor instead of
rejecting the token or restarting at the newest page. Each admitted continuation
reads at most one page, or one confirmed origin and its independent finalized
proof, through the existing provider scheduler. There is no total-page or token
population limit in this recovery path and no new provider concurrency or budget.

SQLite retains the seed, cursor, progress counters and at most eight oldest
potential origin signatures. That candidate window bounds storage only. If its
transactions are proven non-migrations, the next bounded newer range is searched
using an exclusive lower bound; exhausting eight candidates does not exclude a
token. A temporary finalized-read failure retains the original confirmed bytes
and availability time. A restart resumes committed progress. A provider gap or
malformed response supplies no age evidence and uses the existing retry interval.
History older than the 24-hour admission horizon is not acquired indefinitely.

Every continuation is tied to its exact request seed and revision. A direct
migration hint supersedes an earlier swap seed, and late responses cannot replace
its progress. Waiting cursors take FIFO due-time turns; newer incoming hints do
not receive an unconditional priority over them. Observation and financial
ownership still exclude a mint from upstream recovery. Completed results survive
pre-callback registry contention without repeating the provider read.

Only matching independently decoded confirmed and finalized canonical migration
transactions produce a proof. Timestamp hints, history pagination, checkpoint
receipt time and current pool support cannot supply or refresh the migration
birthday. Verified proofs remain immutable, survive restart and are eligible at
exactly 24 hours; the next millisecond removes new-entry age permission without
changing an existing holding's exit policy.
