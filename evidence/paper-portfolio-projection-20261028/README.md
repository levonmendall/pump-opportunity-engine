# Native PAPER portfolio projection repair

Actual source6d live diagnostics reported null experimental portfolio/accounting. The offline integration regression reproduced the exact `unexpected/missing fields` exception using the actual `PaperTrader.funnel`, which includes its separate `reserved` diagnostic. Earlier portfolio fixtures supplied exactly nine counters and missed this boundary.

`buildPilotPortfolio` now explicitly copies the nine authenticated financial snapshot counters. It neither mutates the trader funnel nor removes `reserved` from operating diagnostics, and invalid essential counters still fail validation. Financial, strategy, execution and scheduling behavior are unchanged.

The native reporting catch now exposes a static bounded projection stage and allowlisted reason code. Arbitrary exception text, payloads, paths and credentials remain unexported. Both history-limitation flags plus the maximum50 unresolved fill rows produce a235-character label, within the unchanged256 bound; no label-code change was necessary.

Verification: reproduced pre-fix failure10/11; corrected focused16/16; financial/reporting/native PAPER regressions55/55; TypeScript build and diff check pass. Independent review GO and16/16 rerun. Raw outputs and exact source-file hashes accompany this report.

No runtime, ledger, provider or network access occurred. The current running6d executable was not modified. Forward deployment and actual Render parity remain lead-owned and unverified by these fixtures.
