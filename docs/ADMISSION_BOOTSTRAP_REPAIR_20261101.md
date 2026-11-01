# Candidate-admission bootstrap repair

Base: installed 0044b552ef160bf43823d16578c63431b0bcfd9d. No financial-control exception or trading-rule change.

Observed runtime: discovery/intake progress but zero deep admissions, audits and current-instance HTTP starts. A retained sample has registry contention and local loop lag. These observations do not establish a provider outage or prove every failed cycle has one cause.

The regressions reproduce two independent local starvation mechanisms: optional pre-callback writer contention aborted the entire runner step, and a slow creation-signature selection consumed the 2-second scheduling envelope before a 1.5-second request could start. New unstarted discretionary requests are now planned at current time after lookup. Real audit/window/service deadlines, fresh admission checks, RPC cooldowns, physical settlement and on-chain age validation remain unchanged.

Optional metadata work defers only the typed before-callback lease refusal. Safety-critical retirement/membership still gates the whole step. Unknown failures and errors after a callback starts still fail closed. No quotes, orders, or ledger work are replayed. SQL selection starts from the indexed recent active/migrated universe, preserving priority/cooldown criteria without an artificial token-count cap. Empty age-eligible watch sets skip economic-window ranking entirely.

Tests use actual SQLite and the production runner with explicitly synthetic provider/clock fixtures. Hosted red/green runs and full-suite validation are required; tests do not establish live readiness or profit. Four slots, verified token creation age <=24h, PAPER-only execution, account/history and exits are preserved.
