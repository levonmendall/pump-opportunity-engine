# Independent first sealed-input exporter review

Source review and generated temporary fixtures only; no pilot ledger/provider/
network/actual manifest rewrite was performed by this reviewer.

The exporter diff correctly treats checkpoint source paths as untrusted until
existing native-run/archive/source-prefix/historical-suffix checks complete. It
then verifies the full raw chain against the settled receipt, invokes the exact
source-handoff verifier and compares sealed/raw counters before emitting the
single pinned anchor. The manifest and committed executable identity are
rechecked before output. The CLI still has no pilot-root override. All seven
new disposable boundary tests passed in the review run. First-seal-only scope
is explicit; this does not demonstrate in-process rollover or export after a
sealed anchor has accumulated subsequent chapters.

## Review finding

The underlying handoff verifier compares source hashes/contributions, cumulative
counters, uncertainty and refusal, but not the conservative rolling start history.
A generated fixture demonstrated that a checkpoint originally retaining two
unknown physical starts at its seal time could be edited to retain none, adjust
omittedCount/conservativeUnknownAtSeal, be locally repinned and still pass
verifyResearchCheckpointSourceHandoff with rawSourcesHashVerified:true. The
checkpoint creator itself generated the correct history; the defect is in
verifying a repinned candidate, not in the actual creator result.

Requested narrow correction: derive and compare the first seal's expected
conservative start history from the already checked raw books using that seal's
original createdAt, without moving timestamps, rewriting books or changing
provider budgets. Add the demonstrated counterexample as a regression. Final
GO pending this correction or an explicitly narrower integrity claim that does
not assert verified schedule-history preservation.

## Final review

**GO for the explicitly limited first-seal public-input export.**

The exporter now invokes `verifyNativeInputCheckpointAccounting` only after its
original native/archive/prefix/historical guards. That helper verifies the raw
source hashes/counters and independently derives first-seal start history from
those same raw sources at the anchor's original `createdAt`. It requires exact
retained cutoff, omitted count, unknown-at-seal count, timestamps and original
source-last-observed time. The demonstrated repinning attempt can no longer
remove or backdate conservative demand. This is an export-time integrity check;
no rate timestamps are moved and no manifest or source book is rewritten.

The reviewer reran eight new disposable exporter tests:8/8 PASS. An initial new
fixture used a source-last-observed value below the preserved429 timestamp and
was correctly rejected earlier by the existing reader; its assertion expected
the later new guard. The fixture was corrected to a structurally plausible but
incorrect source time to exercise the intended additional check. No production
validation was relaxed.

Reviewed final hashes:

- Exporter: `5c0b0224dc0b7eb08b782cf1f0c5ac2177d692dba45f207b115be8c75cd7ea00`.
- Tests: `1112dad83585cb4e5b2ce79028f75ce0892309adfd6343a31355c358d97e3575`.

Limits remain explicit: first seal only, all original raw provenance required,
no recursive/adopted-anchor-plus-new-chapter export, no in-process rollover or
continuous-operation claim. Actual source312 benchmark/adoption is a separate
lead verification and was not performed by this reviewer.

Post-review lead note: the sole later exporter delta omits the312-row raw hash
list from its console summary; the complete immutable provenance output still
retains it. The runtime input, verification order and start-history guard are
unchanged. Final exporter SHA256 is
`8b4e7031578af57b34312ac191c7bd70c57a2fbda2501560122685e021d996f5`.
