This package prepares a finite candidate-only observation on the existing EC2 administration runner. It does not install a service, open a ledger, enable entries, alter the original observer, or dispatch itself.

Build from the final reviewed source commit with the existing installed dependencies:

```sh
node scripts/build-native-candidates-ec2.mjs
```

The output is `/tmp/poe-native-candidate-output/{native-candidates.mjs,metadata.json}`. The build checks exact SDK/IDL transforms, pinned dependencies, pure-JS bigint handling, absence of ledger/native-addon inputs, and inert import from a directory without npm modules. This is an offline packaging check, not evidence of forward operation.

For a corrected measurement, pass `--output-directory /tmp/poe-native-candidate-output-NAME` to retain prior builds and receipts unchanged.

Root prepares the actual public input: unchanged explicit counterbooks, actual confirmed/finalized migration transactions, optional watch export, original pilot reporting identity and provenance hash. Set `source.commit` to the reviewed runner commit and `source.sha256` to the executable bundle SHA256. No credential belongs in the input.

```sh
node --import tsx scripts/stage-native-candidate-ec2.mjs \
  --bundle-directory /tmp/poe-native-candidate-output \
  --input /ABS/verified-native-input.json \
  --publisher-directory /ABS/reviewed-reporting-delivery \
  --output /tmp/poe-native-candidate-stage
```

The stager reads only named public inputs/counterbooks and reviewed publisher artifacts. It emits an exact-hash admin workflow and package for review. The workflow in this checkout is a template and refuses to run until staging replaces its hash placeholders. Root must review the generated workflow and files before copying them into the existing administration repository and dispatching.

The job verifies UID994, the exact existing instance, available1GiB RAM/disk, existing Node24.19+, and the original observer identity/PID/restarts. It runs the candidate process for900 seconds including its own10-second shutdown reserve, with an outer1,020-second emergency bound, heap256MiB, sampled RSS384MiB, CPU240seconds, evidence128MiB segmented into8MiB files, and temporary storage256MiB. These are finite research controls, not production-capacity proof.

The separate publisher uses the existing dedicated private reporting file through its permission-restricted launcher. After stopping the watch publisher, the supervisor makes one bounded attempt to publish the real stopped snapshot. A missing accepted acknowledgement remains unverified delivery. No heartbeat is substituted for source timestamps.

The default900-second job preserves before/after receipts, actual source versions, final status/checkpoint, new append-only counterbooks, and every retained selected-flow segment (at most128MiB) in a192MiB uncompressed allowlist. Its artifact upload uses compression level6 and one-day retention. A separate local lossless gzip is capped at32MiB; if that gzip cannot fit, raw default artifact export still remains available. No segment is sampled away and RUNNER_TEMP is not durable storage. No credential or financial file is exported. Existing compute, transfer, and GitHub storage allowances remain separate from zero API purchases.

The opt-in two-hour profile is selected only by `--profile candidate-native-two-hour-research-v1`. It admits candidate information for the source's7,200-second interval including its10-second shutdown reserve; the outer supervisor is bounded to7,320seconds. It retains six observation slots, heap256MiB/RSS384MiB and source CPU1,920seconds (hard1,925). The host must have at least1GiB available RAM and2GiB free disk at startup; ongoing free disk must remain at least256MiB. Local storage is bounded to1,536MiB, selected event evidence to1GiB in8MiB segments, and the complete public export to1,280MiB. These controls are research bounds, not measured provider capacity.

The long profile writes only to its UID994-private directory beneath `/home/mm-ec2-runner/.local/share/poe-native-research/`; it does **not** upload a GitHub artifact. Once owned processes settle, a lossless gzip/tar is capped at256MiB. Archiving runs at nice10 or lower priority with explicit120CPU-second,256MiB peak-RSS and remaining outer-deadline checks (default archive CPU budget30seconds). Any failure preserves raw evidence and marks export incomplete. A completed local gzip is not a verified remote backup; raw evidence remains until download and whole-archive hash verification are confirmed. The fixed-path readback workflow emits at most4MiB of compressed bytes per invocation through bounded log records, with per-chunk hashes. It accepts no arbitrary paths. Root must reassemble and verify the complete archive SHA256. No new storage or paid transfer commitment is authorized.

Both profiles use the shared512KiB counterbook format and32MiB aggregate reader bound. The default initial list remains at most224books; the long profile allows192 to leave64path positions. The manifest reports actual byte runway separately: available path positions do not guarantee64full-size books will fit. No consumed bytes, uncertain reservations or historical refusals are rewritten.

Observation age and data contracts are independent opt-ins. Passing `--observation-age-policy observation-age-selected-24h-study-v1` requires that exact public-input value; otherwise the existing observation-age-v1 policy remains. Passing `--data-contract confirmed-program-activity-v3-shadow` likewise requires the exact input value; otherwise confirmed-program-events-v2 remains. The manifest pins both and the configuration hash computed by the exact executable bundle. Duration alone changes neither policy. The supervisor checks the runtime's actual profile, policy, data contract and configuration hash before starting reporting. This package never enables financial execution.

Successful workflow execution alone does not establish opportunity recall, valid candidate assessments, financial execution, profitability, or continuous operation. Review the actual candidate/audit/provider outcomes and source-to-Render agreement.

The supervisor classifies the source's actual stop reason and lifecycle duration separately from process exit, transport settlement, and reporting. A fatal source stop or premature interval fails the job even when the receiver accepted its stopped report. A normal quiet interval can be mechanically complete with no audited-window evidence. The first two distinct accepted running cycles retain their exact matching source files and ACK/hash metadata for counter and timestamp comparison; later snapshots are never reconstructed as earlier evidence.

Default artifact upload is admitted only after size-checked indexing succeeds. If that check fails, the default job fails and uploads separately labeled failure summaries, source snapshots and new counterbooks. The long profile instead preserves its raw private directory and a failure receipt without uploading an artifact. Neither case claims that full selected-flow evidence was exported. Publisher logs have a1MiB per-file OS ceiling, independently of the runner's8MiB segmented evidence limit.

Offline checks:

```sh
python3 -B operator/native-candidate-ec2/test-runtime-outcomes.py
python3 -B operator/native-candidate-ec2/test-two-hour-package.py
python3 -B operator/native-candidate-ec2/test-readback-public-evidence.py
node --test operator/native-candidate-ec2/test-stage-package.mjs
```
