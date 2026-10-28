# Isolated native PAPER integration — 2026-10-28

This is an implementation and **offline disposable-fixture** milestone. No real pilot ledger, production account, provider endpoint, wallet, blockchain transaction simulator or publisher was accessed by these tests. No natural forward trade or profitability is claimed.

The new `confirmed-program-ordinary-flow-paper-v1` contract deliberately adopts supported successful confirmed program-authored ordinary Buy/Sell events, exact executed integer amounts and fees, event-user attribution and signature/program/log/frame identity. It retains independent executed-flow history audit, exact current 60-second window and ACK-generation certificates. Per-transaction SPL-transfer/compiled-role cross-checks remain unavailable; historical V2 and V3-shadow contracts and records are not rewritten. Protocol effects are not invented buyers and advance pricing slot floors.

The existing single PaperLedger, PaperTrader, execution coordinator, coherent Clock/SDK pricing, backup and reporting projections are reused. The launcher resumes an existing isolated account; it never initializes/reseeds capital, signs or submits. It refuses mismatched identity/inception, mutable startup source, unknown prior writer settlement, missing owned-pool proofs and unsupported bundles. Native source failure closes candidate risk while the independent holding manager retains positions and pending obligations. A fresh audit certificate grants neither a prediction nor a quote, financial permission or fill.

## Verified offline scope

- Exact audit certificate, feature-fingerprint, receipt-availability, current generation and source-support checks; expiry/reconnect/retirement invalidate certificates.
- ACK warming parity and protocol-slot changes preventing stale decision reservation.
- Actual adapter/runner/SDK/ledger composition: two synthetic qualifying ordinary-flow windows produce two $50-limited delayed PAPER buys; a steady-state coherent read prices both holdings in one request. Candidate-source failure and pricing outage preserve exposure. Consistent backup, same-account restart with two unresolved exits, uncertainty/expiry and fresh maximum-hold exits reconcile cash/locked deposits/realized results and 28,000 lamports of modeled gas.
- Entry capacity absent: no preparation/quote request or reservation despite complete predictive evidence.
- Explicit resume/contract CLI, immutable startup provenance, no wallet/trading API surface.
- A new launcher-only reporting starvation defect was found in review: repeated >500ms holding reads excluded every reporting opportunity. The corrected policy reserves a measured 250ms local-report budget before next pending/protection deadlines and services reports after financial work. A separately labeled 750ms-read orchestration simulation obtains reports at 16-second spacing without moving the two-second reference cadence. Actual report duration/overruns/deferrals are exposed; an overrun closes new risk. This is not a guaranteed disk-latency bound or an EC2/reporting-with-holdings measurement.

Raw full-suite output before that last reporting fix: `npm-test-final.txt` (1267/1267); previous adverse fixture output is preserved in `npm-test.txt`. Corrected full-suite output is `npm-test-final-after-reporting.txt` (1268/1268); exact source and output hashes are in `verification-final.json`.

## Exact source-mode commands after freezing the source

The input must use that immutable checkout commit, V3-shadow source identity and the existing pilot account/inception. It is prepared through the existing audited public-input exporter; it must not contain private keys/provider secrets. The new PAPER contract is selected separately and explicitly.

```bash
bash operator/native-paper.sh --resume --directory /workspace/poe-pilot --input /absolute/path/to/frozen-public-input.json --paper-contract confirmed-program-ordinary-flow-paper-v1 --stage single --deep-slots 3 --duration-seconds 1800
```

Status is the existing private `<directory>/status.json`, read by the independent authenticated experimental publisher. Graceful stop: create the existing `<directory>/stop.request`; the launcher closes new admissions, checkpoints held/pending exposure and records monitoring interruption. Remove only that consumed stop request before the same-account resume command. A restart cancels obsolete unattempted buys and quarantines unresolved exits; it never fabricates liquidation or reseeds.

The first source launcher remains intentionally finite (90–1800 seconds) with explicit resource/reserve controls. It is not the continuous supervisor or a 24-hour acceptance configuration. Entry requires at least 910 seconds and 490 request units of remaining management reserve, so an interval shorter than that can validate observation/protection but cannot open new exposure. Position capacity and deep-slot capacity are independent.

## Remaining evidence

No actual launcher forward run, natural executable qualification, natural buy/sell, EC2 financial-addon compatibility, outer-loop reporting cost with open holdings, persistent reporting recovery, extended concurrent protection, or acceptance period is established here. Bundle execution fails closed until the separate reviewed bundle/addon/worker closure is implemented. The final merged tree must be reverified after the independently developed audit-tail and derived-status repairs are integrated. Those limitations must not be replaced with code-existence claims.
