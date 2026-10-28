This package prepares a finite candidate-only observation on the existing EC2 administration runner. It does not install a service, open a ledger, enable entries, alter the original observer, or dispatch itself.

Build from the final reviewed source commit with the existing installed dependencies:

```sh
node scripts/build-native-candidates-ec2.mjs
```

The output is `/tmp/poe-native-candidate-output/{native-candidates.mjs,metadata.json}`. The build checks exact SDK/IDL transforms, pinned dependencies, pure-JS bigint handling, absence of ledger/native-addon inputs, and inert import from a directory without npm modules. This is an offline packaging check, not evidence of forward operation.

For a corrected measurement, pass `--output-directory /tmp/poe-native-candidate-output-NAME` to retain prior builds and receipts unchanged.

Root prepares the actual public input: unchanged explicit counterbooks, actual confirmed/finalized migration transactions, optional watch export, original pilot reporting identity and provenance hash. Set `source.commit` to the reviewed runner commit and `source.sha256` to the executable bundle SHA256. No credential belongs in the input.

```sh
node scripts/stage-native-candidate-ec2.mjs \
  --bundle-directory /tmp/poe-native-candidate-output \
  --input /ABS/verified-native-input.json \
  --publisher-directory /ABS/reviewed-reporting-delivery \
  --output /tmp/poe-native-candidate-stage
```

The stager reads only named public inputs/counterbooks and reviewed publisher artifacts. It emits an exact-hash admin workflow and package for review. The workflow in this checkout is a template and refuses to run until staging replaces its hash placeholders. Root must review the generated workflow and files before copying them into the existing administration repository and dispatching.

The job verifies UID994, the exact existing instance, available1GiB RAM/disk, existing Node24.19+, and the original observer identity/PID/restarts. It runs the candidate process for900 seconds including its own10-second shutdown reserve, with an outer1,020-second emergency bound, heap256MiB, sampled RSS384MiB, CPU240seconds, evidence128MiB segmented into8MiB files, and temporary storage256MiB. These are finite research controls, not production-capacity proof.

The separate publisher uses the existing dedicated private reporting file through its permission-restricted launcher. After stopping the watch publisher, the supervisor makes one bounded attempt to publish the real stopped snapshot. A missing accepted acknowledgement remains unverified delivery. No heartbeat is substituted for source timestamps.

Before/after receipts, actual source versions, final status/checkpoint, new append-only counterbooks, and all retained selected-flow evidence (at most128MiB) are uploaded directly within a192MiB uncompressed artifact ceiling. No duplicate local archive is created, no selected segment is sampled away, and RUNNER_TEMP is not treated as durable storage. No credential or financial file is exported. Existing compute, transfer, and GitHub storage allowances remain separate from documented zero API purchases.

Successful workflow execution alone does not establish opportunity recall, valid candidate assessments, financial execution, profitability, or continuous operation. Review the actual candidate/audit/provider outcomes and source-to-Render agreement.

The supervisor classifies the source's actual stop reason and lifecycle duration separately from process exit, transport settlement, and reporting. A fatal source stop or premature interval fails the job even when the receiver accepted its stopped report. A normal quiet interval can be mechanically complete with no audited-window evidence. The first two distinct accepted running cycles retain their exact matching source files and ACK/hash metadata for counter and timestamp comparison; later snapshots are never reconstructed as earlier evidence.

Full artifact upload is admitted only after size-checked indexing succeeds. If that check fails, the job fails and uploads separately labeled failure summaries, source snapshots and new counterbooks; it does not claim that full selected-flow evidence was exported or that RUNNER_TEMP is durable. Publisher logs have a1MiB per-file OS ceiling, independently of the runner's8MiB segmented evidence limit.

Offline supervisor regressions: `python3 -B operator/native-candidate-ec2/test-runtime-outcomes.py`.
