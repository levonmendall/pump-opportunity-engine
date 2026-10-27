# Dashboard reporting verification — 2026-10-27 UTC

Reporting-only release `8d9f43cf242690df3fe6cdae464262659cf5c80b` is live on the
existing Free Render service; deploy `dep-dbgfhdcot0ks73cooaq0` finished
19:18:36.068Z. Two authenticated cycles at 19:19:17Z and 19:19:41Z match the
actual local pilot status projection exactly. The independent read-only publisher
uses a separate reporting credential; the original EC2 channel and account remain
unchanged. Browser verification at 390×844 passed without overflow or JavaScript
errors. See [pilot reporting](docs/PILOT_REPORTING.md) and bounded evidence in
`evidence/dashboard-reporting-20261027/`.

The experimental pilot is **STOPPED**, with last source facts
**2026-10-27T18:43:13.922Z**, account
`poe-pilot-8468add6-f916-48cf-a585-6cd008a81360`, original pilot inception
`2026-10-27T17:56:13.252Z`, source `87708b4c9ff7d96dcb5263dbebd997cdb67db09e`,
strategy `persistent-buying-pilot-v1`. Its panel reports this truthfully; publisher
contact does not refresh pilot facts. Run diagnostics include 10 admitted
candidates, 43 evaluations, 14 usable windows and zero PAPER fills/exits. These
are experimental diagnostics, never the original portfolio's performance.

Publisher disconnect detection also passed in the API and mobile browser;
reporting resumed at 19:21:48Z without refreshing pilot source facts. The publisher
is a separate Cloud development process; no availability beyond this environment's
lifetime is implied. No owner action is required for this reporting repair.

The original observer's public snapshots still report the original account and
inception, entries disabled and cash reconciliation. This was a reporting check,
not a new EC2 systemd check or independent private-ledger audit. No trader was
restarted, no account reseeded, no strategy changed and no acceptance clock started.

## Historical status (2026-10-26; retained, superseded where noted above)

# POE status — 2026-10-26 UTC

**EC2 healthy; authenticated reporting accepted; public dashboard fresh.**
Natural PAPER trades: **0**. Cash-only reconciliation is current. New metered
data/cloud spending: none; existing hosting allocation/invoices remain unknown.
No supported-market coverage or production throughput claim. Main blocker:
billing-wallet recovery/funding and real selected-token flow verification.
**No acceptance clock has started. Edge UNPROVEN; LIVE DISABLED.**

| Status | Evidence |
|---|---|
| BUILT | Observer/accounting/reporting installed; development strategy, execution, costs and backup core tested |
| RUNNING | One restricted EC2 observer and existing free Render viewer |
| OBSERVING CURRENT DATA | Free PumpPortal migrations and public Coinbase SOL/USD; no selected-token flow |
| PAPER-ENTRY ENABLED | **No**: feed fields/budget unverified, rule unfrozen, production management integration incomplete |
| NATURAL PAPER TRADES | **0**, positions0; disposable tests remain separate |
| ACCOUNTING RECONCILED | Fresh authoritative cash-account reconciliation; independent private DB balance audit unavailable through runner |
| DASHBOARD FRESH | Same actual account/inception/runtime/strategy; public GET, private machine POST |
| OPERATIONALLY ACCEPTED | **No**; Gates A–D incomplete,24/72-hour clocks unstarted |

## Installed authority

Instance i-00044d4ea1471b957, account133857166104, us-west-2.
poe-runtime.service runs enabled/nonroot uid988 since22:30:55UTC, zero restarts.
Installed release **bce3d22bb434eb429aafacb788a18f39ec189c1b**.
The owner-completed standard Node launch override fixes C2's symlink main-path
bug; no bootstrap rerun, replacement/reseed or key change occurred.

Account **poe-3123e352-4581-455b-85db-acd7e825e99e**.
Original inception **2026-10-26T22:07:36.212Z**, one $1,000 VIRTUAL conversion.
Strategy **UNIMPLEMENTED_FLOW_BLOCKED**. No legacy/fixture history imported.

Read-only run40415427271 attempt3/job121922314841 during Render rollout:
reconciliation/USD facts aged4.168seconds, latest migration117.275seconds,
shortlist12/12, NTPyes, memory63,074,304bytes, cumulative CPU12.525seconds,
root filesystem57,831,047,168bytes available. No cleanup needed/performed.
This is a low-load observer sample, not a trading capacity benchmark.

## Dashboard

https://meme-machine-dashboard-staging.onrender.com .
Only srv-daqon53tqb8s73bdceq0 / tea-daqk6h8jo6nc73eojtp0, free, auto-deploy off.
Verified live web source **b3df32ce098d5de0c38c706bf9cf8e6066eccec1**,
deploy **dep-dbfuh559el5s73bbf3pg**, finished23:57:11UTC.

Owner explicitly confirmed PUBLIC read-only viewing. Dedicated machine ingestion
remains authenticated; wallet/provider/Turnkey keys never reached Render.
Earlier41 live protocol checks passed; a concurrent UI passed20 current core/
mobile checks but dropped visible release/strategy metadata. The dashboard-only
fix restores those fields while preserving design and financial identity.
Final22/22 deployed checks pass at23:57:48UTC: sequence159, source facts
34.7–35.7seconds old, full versions visible,12cards/actual history agree,
no mobile overflow, controls, script errors or external requests. One waiting503
resolved by natural full republication; no EC2 restart. See
evidence/render-current-live.json. Final23:59:47UTC source check: sequence163,
source/reconciliation age26.3seconds, correct identity, zero trades/positions.

EC2 remained active with unchanged startup/account through cache/redeploy outages.
Normal full republication restores bounded history and genuine gaps; dashboard
heartbeat does not refresh underlying facts. Zero-trade movements are SOL price
effects, not strategy profit. Missing operating allocations keep economic P&L
unavailable. Some installed observer projections remain explicitly unavailable.

## Development and next work

Reviewed commit b3df32c adds bounded normalized features/rule, measurement core,
delayed one-attempt execution, connected DISPOSABLE trader, actual-size sell
pricing, same-writer operating costs and asynchronous bounded backups.
Typecheck, compiled build,185/185 regressions and11 operator tests pass.
Strict script checking/independent review also pass. Synthetic replay preserves
information availability and drains its tested workload; it is not EC2 capacity
or forward performance. Actual free migration/Mayhem Token-2022 quote evidence
is preserved, explicitly QUOTE_ONLY and modified-source where applicable.

**These trading/backup changes are not installed on EC2.** Finish actual feed
field/rate/charge proof; production RPC/management/scheduler and projections;
freeze rules/cost assumptions; deploy an account-preserving reviewed release;
prove actual backup/restore, restart/outage/pressure/headroom and alert delivery.
No critical-alert channel is verified. No full gate or economic edge claimed.

Turnkey authentication/source identification are complete and credentials unchanged.
Existing source cannot fund requested0.06SOL plus fee; billing wallet remains0SOL.
Durable owner recovery lacks an actual named private route. No key export,
transfer approval/signing/broadcast, paid RPC/hosting upgrade or automatic top-up.
Measurement caps remain0.01SOL/day,0.04SOL/four-day total,$2.50/day/$10total
whichever binds,0.02SOL floor. They do not establish continuous-window capacity.
See docs/OWNER_ACTIONS.md for only actual owner dependencies.
