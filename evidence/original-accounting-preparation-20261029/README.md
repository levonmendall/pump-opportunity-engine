# Original-service cutover accounting preparation

This is package preparation, not a new trading account, market measurement, service deployment or financial migration. Offline verification passed 15 TypeScript fixture cases, four Python lease tests and the repository TypeScript build. The actual fixed EC2 command has not been executed by this implementation task.

The immutable bundled `src/prepare-original-accounting.ts` reuses `createResearchBaselineCheckpoint` and `verifyResearchCheckpointSourceHandoff`. The parent wrapper acquires the stopped d7 source's three **existing** locks read-only: its financial-owner lease and the actual `/tmp/poe-public-component-20261027.lock` / `/tmp/poe-pumpapi-probe.lock`. Missing or busy locks refuse preparation; no replacement lock is created. All three remain held until the child physically settles. No financial database is opened.

Source input is the actual stopped run's `pilot.json`, `status.json`, and `runs/native-paper-20261028223428977/settlement.json`. `paper.json` is not the d7 manifest filename. The helper requires the exact d7 executable source/hash, flat stopped status, settled transports, ordered anchored chapter paths and the recorded cumulative source totals: 8,959 units, 1,016,377,544 accounted bytes, including 519,831,552 uncertain bytes. It recomputes those totals from the existing chain and verifies the new handoff against every source hash. Historical refusals and uncertain debits survive. The 27 public-RPC probe units and six Cloud diagnostic units remain explicitly separate; they are not invented into this chain or reset.

Only a new private `/var/tmp/poe-issue11-accounting` directory is created. It contains append-only `sealed-baseline.json`, `receipt.json`, `original-status.json` and the wrapper's bounded process log. Existing outputs cause refusal. Partial outputs remain available for diagnosis. The original public status copy is bounded to 4 KiB and requires the exact original account, inception and installed bce source; no private original financial file or credential is read. The three allowlisted output files are emitted as hash/byte-count/base64 records for verified reconstruction by the existing administration path.

The fixed wrapper uses `/opt/poe/node/bin/node` with 96 MiB heap, 256 MiB observed RSS stop, 20/21 CPU-second bound, 85-second stop / 90-second aggregate ceiling, 1 MiB process-output cap, no core dump and a parent-death guard. These are one-shot offline package-preparation bounds, not lifetime limits for the autonomous service. It performs no provider calls or service operations.

The lead must bundle the reviewed TypeScript entry into `operator/native-paper-ec2/prepare-original-accounting.mjs`, retain its exact hash, and stage the wrapper/helper through the existing administration mechanism. The fixed host command requires the existing runner identity and `EXPECTED_PREPARE_ACCOUNTING_SHA256`; it accepts no alternative account/path arguments. Do not run fixture data as if it were host authority. Root service-package assembly consumes the actual resulting baseline and public status, and independently audits the original ledger before any upgrade.

Reproduce offline checks:

```sh
node --import tsx --test test/prepare-original-accounting.test.ts
python operator/native-paper-ec2/test-prepare-original-accounting.py
npm run build
```

## Host preparation refusal and narrow correction

Host workflow 40792959630 refused before output-directory creation in approximately 0.05 seconds. Its original generic exception did not establish which precondition failed. `/opt/poe/node/bin/node` permission was a hypothesis, not a measured root cause. Preserve that refusal unchanged.

The unprivileged preparer now reuses only `existing_node()` from the existing administration selector whose complete source hash is `23a6a1573bca181041ea9db55164f05197ad929e5a53ace89613f64011b7dd6b`. This chooses an already accessible Node 24.19+ executable from the existing runner's allowed locations. It does not install software, modify `/opt/poe`, change permissions or execute other selector actions. The existing `RUNNER_TEMP` variable must be passed through the wrapper's otherwise minimal environment. The source bundle and accounting helper are unchanged.

Failure records now include a fixed phase enum, exception type, numeric errno and errno name. They omit exception messages and private paths. Six Python tests passed, including secret/path omission and rejection of arbitrary phase values. Actual corrected host preparation must establish the outcome; these tests alone do not resolve the original access failure.
