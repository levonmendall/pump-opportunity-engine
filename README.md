# Pump Opportunity Engine

Independent Solana/PumpSwap PAPER project. **Work in progress, not a deployed trader.**
Live signing, transaction submission and PumpPortal trading endpoints are excluded.
See [status](STATUS.md), [implementation plan](PLAN.md), and [runbook](docs/RUNBOOK.md).

Use Node24.19.0. From this clean directory:

```sh
npm ci
npm run build
npm test
npm run integration
```

The last command opens one free migration WebSocket for at most five minutes and
uses bounded public read-only mainnet RPC. It tries at most three selected events,
captures compact evidence, verifies the actual migration/creation and canonical
pool, and obtains a 0.01 SOL buy and same-state matching sell estimate. Exit0
means a real integration proof; exit2 means no successful proof in the bounded
window. A quote is not a paper fill. No account is seeded by any integration run.

Rerun a captured discovery against **current** RPC state:

```sh
npm run integration -- evidence/selected-direct-migration.json
```

Offline regressions reuse actual captured observations while keeping their
simulated accounting state in disposable temporary accounts. No fixture balances
or chart history are published as forward performance.

The reporting service is independently runnable after `npm run compile` with
the reporting identifiers/credentials listed in [.env.example](.env.example).
Run `npm run dashboard`; it binds `0.0.0.0:$PORT`, starts empty, and only accepts
authenticated complete snapshots. No real source currently publishes to it.

Render replacement configuration is prepared but not deployed. The owner amended
authorization to reuse only existing service srv-daqon53tqb8s73bdceq0 on its free
plan. Read the runbook before switching its source; do not create a second service.
