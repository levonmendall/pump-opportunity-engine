# Corrected original-service PAPER upgrade

This packet upgrades only the verified source `69aa1ef214a8c79524a25a8aca79299ccaad93dc` to `02fbec4f548c02f81663c707f31b7b62ea335133`. It supersedes the unapplied reservation-priority/a1 instruction and the held a16 packet. Their frozen artifacts and commands remain retained unchanged. Do not apply the held a16 command: its unsigned transaction omitted the ComputeBudget instructions represented by its modeled priority fee.

The corrected standalone construction includes the checked 200,000-CU limit and 10,000-micro-lamport CU price. These are PAPER execution assumptions, not observed chain fills or paid fees.

## Frozen package

The immutable payload is in `upgrade-package-final/`. The reviewed command is `upgrade-package-final/OWNER_APPLY.txt`; its SHA-256 is `aef4a3adbb70498095961fd15da1d5520058011dba5d77e82d7673bb94dd6a1b`.

| Binding | SHA-256 |
| --- | --- |
| Native | `16805b01382b10e2bf59952e93e218d8a2e5afc70c4275d65ff4be003095abdb` |
| Configuration | `1a81d2156865467cab6300c260a809e0f98ae6649bdd88b4161f13b4c7d8edef` |
| Driver | `133ffec146c63d6336cdb16bc654ec82a73a61999eafc8d065318ec9e4e78dcc` |
| Index | `833a0270c4e5c82f483cbca253315f70ef0a24f4fe996487872d933a0ef63043` |
| Transport | `f377bcba2cabc6618e4f672cc37df3b54e9b0943a3560a4708a33c934d0235a8` |

The exact before receipt and source-window provenance remain in `../paper-equity-execution-20261030/before-verification/`. The installer admits that single before-source/configuration pair, rather than either source69 or a1.

## Changed semantics and retained obligations

This is a risk, configuration, additive financial-state and execution-semantics change. The same financial writer activates the 5% consumed-cost allocation policy and persisted 10% daily observed-equity high-water drawdown policy. New execution plans retain their unsigned intent, scenario fee/delay and rent evidence. Current-source USD diagnostics and original reporting projections are included. Policy facts becoming available do not grant entry permission.

Four deep observation slots, two held positions, PAPER-only execution, the original account and exact prior journal/action prefixes remain required. The installer performs no daily-loss reset, hard-control clear, new waiver or order creation. Existing held obligations retain their explicit compatible protective path. Post-start executable downgrade is prohibited because the new state may not be accepted by an old executable.

## Verification and handoff

The frozen operator source is `955928546fe8ef69321ece9ac4f1bbf58b1a455d`; matching admin source is `e76836edfc2f9703cca78757142d3f7b406b8c23`. `final-verification/verification.json` records 74 passing operator tests, all tracked source/payload hashes unchanged, and owner-command syntax verification without execution. Independent review also checked the corrected standalone SDK constructions, all payload/transport/admin bindings and the separate bounded readback mechanism.

Use the already registered `poe-original-cutover-resume-stage.yml` workflow for nonroot staging. The new unique workflow filename remained unregistered despite valid YAML/actionlint, so the registered workflow now verifies this exact transport and unique target directory. Readback uses the registered `poe-original-cutover-refusal.yml` and the separate source/hash/root-receipt-bound reader; the original inspector and its 32,768-byte bound remain unchanged.

This agent assembled and verified offline artifacts only. Parent owns publication, nonroot dispatch, the necessary privileged owner step, actual installed-source/account verification and forward monitoring. This evidence claims no deployment, current entry permission, protection reliability or profitability.
