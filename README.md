# Pump Opportunity Engine

Standalone Solana/PumpSwap PAPER project. **EC2 observer and public dashboard
running; autonomous PAPER trading not enabled. Live trading disabled.**

Public read-only dashboard:
https://meme-machine-dashboard-staging.onrender.com .
No viewer password. Machine ingestion still requires a dedicated Bearer secret;
wallet/provider/Turnkey credentials never belong on Render.

The original new $1,000 virtual account retains its2026-10-26T22:07:36.212Z
inception. Nonroot EC2 observes free PumpPortal migrations/public SOL/USD,
reconciles its cash-only account and publishes snapshots. Natural PAPER trades:0.
Selected-token flow, sustainable billing capacity and production execution are
unverified. Entries stay disabled; no acceptance clock has started.

Development connects bounded normalized features/rules, delayed PAPER execution,
actual-size exits, single durable ledger, operating costs and consistent backup
scheduling. Disposable tests are separate from forward results. These changes
are not installed trading evidence. No signer/submission path is available.

See [status](STATUS.md), [plan](PLAN.md), [runbook](docs/RUNBOOK.md),
[remaining owner actions](docs/OWNER_ACTIONS.md), [cutover](docs/RENDER_CUTOVER.md).
Existing Turnkey authentication/source identification are complete. Durable
billing-wallet recovery and sufficient funding remain; no transfer is approved.

Use Node24.19.0:

```sh
npm ci
npm run build
npm run compile
npm test
npm run integration
```

Integration is a bounded free migration→canonical pool→size-specific buy/sell
probe, not a daemon or fill. Receive/slot evidence is retained. No account is
seeded. Tests use separate disposable state, never forward portfolio history.

The independent reporting app runs with npm run dashboard after compilation and
reporting-only .env.example configuration. Empty cache waits for a valid full
EC2 snapshot, never capital/fabricated history. Existing Render auto-deploy is
off; dashboard changes never restart EC2. No second service or paid upgrade.
