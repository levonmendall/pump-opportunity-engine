# Settled candidate-batch faults must not delay healthy holding pricing

**Offline repair, not forward protection acceptance.** Base
b9bba473de026ec630033a2c95167fa31c027c0d treated the optional quiet-batch512KiB
size cap, malformed JSON and unscopable batch envelope as ordinary recoverable
provider outages. After physical settlement it unnecessarily imposed global
2/5/10-second HTTP backoff. Disabling the optimization prevented a permanent
fatal state but still delayed unrelated held-position SDK reads.

The baseline-failure log reproduces all three cases with the same new SDK
regression against unchanged base source. Candidate-batch failure alone created
a future global cooldown. Original failures, source/test hashes and exit status
are preserved rather than replaced by the passing result.

The narrow PilotRpc branch now applies only when the caught error exactly
matches one of those three batch-specific halt reasons, actual HTTP status is200,
no Retry-After hint exists, and the physical operation has actually settled with
no waiting operation or storage failure. Failed candidate queries remain
unavailable and batching remains disabled for the run. The global cooldown and
prior global failure streak stay unchanged. The next ordinary request still
passes the same physical gate, chapter recovery, rolling quota, spacing, byte
reserve and admission checks. Every received byte and uncertain reservation is
retained. No failed batch or candidate window is retried or declared complete.

An explicit Retry-After on a failed200 response is now retained before the
existing header-status early return, so it cannot be accidentally waived. Real
429/503/overload, physical timeout/cancellation, unknown settlement and genuine
2MiB/storage/accounting/diagnostic failures remain governed by their existing
shared refusal rules. A failed durable counterbook is explicitly storage-fatal;
recording failure in the new scoped diagnostic is also fatal.

**124 focused tests and TypeScript build passed; independent review GO.** Three
new tests run the actual ResearchClockPositionPricer/SDK over retained supported
pool/mint/vault/fee bytes with an explicitly synthetic fresh Clock and chronology:
2 cold quote reads → failed candidate batch → fresh1-read steady held quote.
The new quote completes within255ms after the settled fault (existing250ms
spacing plus5ms fixture response), within the2-second target evaluation interval,
with the same integer sell quantity/proceeds and quote age at use≤2seconds.
No artificial2/5-second wait is inserted. Prior uncertain bytes, actual starts,
and N logical/one physical batch counters remain unchanged.

Negative tests retain global15-second cooldown for HTTP200/503 Retry-After,
preserve the genuine global failure streak (2s, scoped candidate fault, then5s),
and preserve fatal diagnostics/storage/hard-size behavior. Existing tests cover
unsettled cancellation, late429/503, quota/chapter recovery, and SDK source and
account validation. These are deterministic isolated fixtures: no live provider
reliability, EC2 timing, natural exit response or trading performance is claimed.
No network request or financial-ledger access occurred.
