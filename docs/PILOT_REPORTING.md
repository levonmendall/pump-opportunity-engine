> RETIRED by issue #11. Historical design only; do not configure or start this separate channel. The original account and `/api/snapshot` are the sole operating target. See [REPORTING.md](REPORTING.md).

# Separate pilot diagnostics

Reporting-only repair of the existing Render dashboard. The EC2 portfolio keeps
its original authenticated `/api/snapshot` channel and account. No trader,
strategy, ledger or EC2 service changes are included.

The independent `/api/pilot` channel accepts only a bounded diagnostic projection:
identity, source times/version, run state, counters, recent decisions and refusals.
It never accepts pilot balances or portfolio performance. Its dedicated secret
must differ from the original publishing credential. Public viewing remains
read-only; machine ingestion requires authentication.

## Deployment binding

Existing service: `srv-daqon53tqb8s73bdceq0`, Free, auto-deploy off, original URL
`https://meme-machine-dashboard-staging.onrender.com`.

Read the pilot's actual private status file before configuring:

- `POE_PILOT_ACCOUNT_ID`: `poe-pilot-8468add6-f916-48cf-a585-6cd008a81360`
- `POE_PILOT_INCEPTION_AT`: `1793123773252`
- `POE_PILOT_INGEST_SECRET`: separately generated reporting-only secret, attached
  through the authenticated Render environment-variable merge operation.

Do not replace the original Render environment-variable collection. Do not put
the secret in Git, command arguments, browser JavaScript or logs. The publisher
reads its own private secret file. Neither channel needs wallet/provider secrets.

## Independent publisher

Build with `npm ci --include=dev && npm run compile`. In a separate nonroot
process, set the nonsecret identity variables above and
`POE_PILOT_INGEST_SECRET_FILE` to the owner-only reporting credential file. Run:

```sh
node --use-env-proxy scripts/publish-pilot-status.mjs \
  --file /workspace/poe-pilot/status.json --watch
```

Use Node's filesystem permission allowlist and ordinary process limits when
available: read access only to this script, compiled telemetry module, package
metadata, status file, reporting-secret file and required TLS trust files; no
filesystem write or subprocess permission. Keep output in a private bounded log.
The publisher does not open the ledger, import the trader, control the pilot or
call a market provider. SIGTERM stops only reporting. A new process resumes from
the same status file without changing the account or source timestamps.

Successful reporting repeats every 15 seconds; failures back off up to 60 seconds,
with a five-second request timeout and no reporting backlog. The receiver cache
is replaceable and empty after a deploy until a valid complete report arrives.

## Interpretation and checks

`generatedAt` is the pilot's local source timestamp. `receivedAt` is the first
acceptance of those facts. `lastContactAt` advances on authenticated identical
retries. Neither contact nor browser polling refreshes source facts. Source and
publisher become stale independently after 90 seconds. A stopped pilot remains
stopped even while its independent publisher is connected. Missing holding
evaluations are unavailable metrics, not zero-duration protection evidence.

Verify two real reporting cycles against the actual local status file, original
account identity, unauthorized POST rejection and the separate credential
boundary. Stop only the publisher to check disconnected behavior, then restart
it. Check the actual deployed page at mobile size. Preserve the original source
timestamp throughout these checks. Reporting acceptance does not establish
trader health, market coverage, natural PAPER trades or operational acceptance.

To roll back reporting, deploy the preceding reviewed dashboard commit with
auto-deploy still off. Leave the original snapshot channel untouched. Stop the
separate publisher if the rollback lacks `/api/pilot`. No financial restore or
EC2 runtime restart is involved.
