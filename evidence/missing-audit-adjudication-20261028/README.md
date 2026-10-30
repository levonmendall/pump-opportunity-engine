# Post-settlement missing-signature adjudication

This component is prepared for one finite diagnostic after `40780989966` has physically settled flat. It was reviewed before execution. The lead subsequently completed one bounded six-read diagnostic; the version-guard review below makes no additional network request. No runtime, ledger, account, trading permission, provider plan, credential or historical result is changed.

The six fixed cases contain two retained c189 failures plus four current cases: AfPhjr midwindow, CurpZp at the end boundary, 3XNU midwindow, and 5VTin7 requiring two audit pages. Selection diagnoses failure mechanisms; it is not a winner sample or a completeness denominator. The current cases were extracted from the independently verified16-file archive and its exact selected-event hash. Their original timestamps, slots, source lines and hashes remain in `plan.json`.

Only finalized `getTransaction` reads use `https://api.mainnet.solana.com`. There is one physical operation at a time,750ms between starts, at most six requests, no retry or rerouting,3s diagnostic timeout plus1s physical cancellation settlement, and30s application admission/shutdown envelope. The3s diagnostic timeout does not change the operating audit timeout. All retry hints stop further cases; unknown hints remain unresolved. Failed physical operations retain2MiB uncertainty; counters are append-only auxiliary usage.

The MJS fetcher records raw public transaction bodies privately and their actual availability. The separate TS classifier reuses `inspectScopedPumpSwapInstructions` and `mapConfirmedPumpSwapEvidence`: actual signature, slot, success, canonical mint/pool, compiled swap denominator and transfer checks must agree. Unknown instructions, absent events, incomplete evidence and null transactions remain unresolved. A proven nontrade could justify a future versioned timely exemption; **all original frozen windows remain unusable**. Later data never becomes an earlier signal.

## Lead-only execution after settlement and source review

Use the existing nonroot Cloud user (UID1000 observed), inherited proxy/CA configuration, and a new private output parent outside either financial account. Do not execute while a source using the shared provider budget is active. Honor any actual outstanding Retry-After first.

```bash
install -d -m 700 /workspace/poe-diagnostic-evidence
python3 -B -I operator/native-paper-ec2/run-missing-audit-probe.py \
  --plan "$PWD/evidence/missing-audit-adjudication-20261028/plan.json" \
  --output-directory /workspace/poe-diagnostic-evidence/missing-audit-six-20261028
```

The purpose-specific wrapper runs the exact local MJS with nice19,96MiB Node heap, CPU8s soft/9s hard, one private receipt file below4MiB, and at most64KiB child output. It monitors RSS256MiB and requests termination at35s outer elapsed time (scheduler jitter and bounded TERM/KILL settlement remain separately measured), terminates the owned process group with TERM→KILL, and installs a Linux parent-death guard. It reads no financial file and makes no provider call itself. If it is interrupted or settlement is unverified, retain every started/reserved operation and uncertainty; no automatic second attempt is permitted by the command.

Extract the one `kind:"result"` record's `data` to a bounded local JSON file for the offline classifier, retaining the receipt hash; count any duplicated analysis file in retained evidence. The raw transaction body is not public dashboard data. Run the classifier with no networking and retain its output separately from forward results:

```bash
node --import tsx scripts/adjudicate-missing-audit.ts RESULT_JSON OFFLINE_RESULT_JSON
```

Source-frozen application remains d7eab54; this diagnostic is not a production data-path adoption or acceptance. Actual API calls/bytes/uncertainty and any unverified infrastructure costs must be reported after execution. A successful code test is not a successful live adjudication.

## Version-guard correction and actual offline parity

The six captured responses contain legacy/v0 transactions plus two version1 messages with `transactionConfig`. The frozen fetch source explicitly requested `maxSupportedTransactionVersion:1` (sourceSHA642166a6…), not0. Accepting acquisition of a version is not proof that its semantics have been validated. The existing full mapper's syntactic version allowlist included1, but this diagnostic has no supported-version1 fixture or independently established message semantics. The offline classifier now marks both `UNRESOLVED_UNSUPPORTED_TRANSACTION_VERSION`, preserving the initial output as adverse evidence. Main runtime/mapper policy is unchanged.

The revised result is one exact `sweep_protocol_fee` nontrade, three missing executed Sells, and two unresolved version1 cases. Every original window remains unusable. One Sell was routed; two were direct. Replaying the three actual later full-RPC log arrays through the existing native parser gives exact trade count, amounts, trader and fee parity with the compiled-instruction/transfer-validated full mapper. All three pool addresses are in static keys, not only lookup tables; none has an explicit truncation marker or parser error. These facts do not prove original WebSocket delivery, its timing, or which upstream/local stage lost a packet. `compare-real-sell-logs.ts` reproduces the offline comparison without networking.
