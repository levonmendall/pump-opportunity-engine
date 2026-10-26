# Pump Opportunity Engine

**Dashboard access (2026-10-26):** The existing free Render viewer at
https://meme-machine-dashboard-staging.onrender.com is public read-only with
`POE_PUBLIC_VIEWER=true`. No visitor username or password is required. Published
balances, positions, trades, decisions and exports are publicly visible.
Only `POST /api/snapshot` requires `POE_INGEST_SECRET` as a machine-only
Bearer token; no trading or wallet credentials belong on Render.

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
the reporting identifiers and publishing credential listed in [.env.example](.env.example).
Run `npm run dashboard`; it binds `0.0.0.0:$PORT`, starts empty, and only accepts
authenticated complete snapshots. No real source currently publishes to it.

Production PAPER accounting, offline account controls, a restricted service
template and a pinned EC2 installer are also prepared. `npm run account -- ...`
operates only with an explicitly initialized account. `npm run runtime` is an
**entry-blocked observer**, not an accepted trader: no strategy/fill/exit path is
enabled, and production startup refuses existing exposure. See the runbook before
initial installation; never use fixtures as the authoritative account.

Existing Turnkey identification is operator-only under operator/turnkey. The
owner-supplied API authentication pair is stored privately outside git and
passes local pair validation. Read-only queries return401 PUBLIC_KEY_NOT_FOUND
in the supplied organization; registration/binding remains to resolve. No wallet
accounts are identified or transactions authorized. Manual existing-Turnkey
funding remains an option after recovery, public-sender/fee verification and
explicit transfer approval.

The POE viewer is live at https://meme-machine-dashboard-staging.onrender.com,
release3af3f9ed9abde5178379e18e986e07ab41965d22, on the existing free service.
The old Basic-auth verification is superseded by the public-viewer release 2bd35bf. The awaiting-data state remains source-dependent;
the authoritative EC2 account/source is not installed yet. See the runbook for
the one-time root bootstrap. No source edit, publisher shutdown or deploy click
needs repeating. No second service or paid upgrade is authorized.
