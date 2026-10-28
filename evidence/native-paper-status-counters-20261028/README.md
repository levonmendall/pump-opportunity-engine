# Native PAPER observation reporting and financial-visibility admission

This isolated repair is based on ce16f0f. It does not alter the live6d894c1
segment, historical evidence, strategy thresholds, data validation, provider
limits or financial account. No network requests or actual financial files are
used by this verification.

The PAPER launcher previously serialized WATCH-only PilotFeeds usage, whose
normalized trade count is zero by design, while native program flow lives in
PilotNativeFlow. It also serialized an unannotated watch summary and financial
trader decisions only. That hid independent predictive assessments and native
flow from the existing publisher. The new small pure helper reuses the existing
nativeCandidateReportingProjection for exact native+broad usage and watch
assessment/failure counts. It retains financial trader counters/portfolio facts
separately and merges only the latest50 timestamped, stage-labeled decisions.
Financial portfolio decisions remain the trader's original decisions. No extra
quote, enrichment or RPC request is introduced.

The exact deployed a40c75e standalone publisher compatibility test verifies the
supported existing Render fields. It exposes watch assessment/failure totals,
native normalized events, aggregate received bytes/events and recent decisions.
The new raw local independentPredictive counters also retain notRejected,
unavailable and uniqueEvaluated; the current deployed publisher does not export
those three totals. Do not claim those totals are visible on Render yet.

The reviewed new admission policy is
validated-financial-projection-before-new-risk-v1. It starts closed and opens
only after both validated financial portfolio and accounting projections have
been constructed. A construction failure clears both outputs and closes only
NEW risk. Native candidate capture, already-reserved orders, held protection and
pending exits remain independent. A valid projection may itself show unknown
USD/marks; this gate does not reinterpret unknown prices as current or change
any existing pricing/risk check. The policy is included in the configuration
hash, so both normal and management configuration hashes must be recomputed.

A controlled SDK fixture proves complete independent observations remain
available while admission is closed; after one permitted reservation, closing
admission does not prevent its existing delayed buy, held-size pricing,
maximum-hold sell or exact same-account reconciliation. This is synthetic
mechanics, not a natural trade or profit result. Actual next-source Render
visibility and live recovery remain to be verified by the lead.

Reproduce:

```
node --import tsx --test test/native-paper-observation-reporting.test.ts test/native-paper-launcher.test.ts test/native-paper-integration.test.ts test/native-paper-interop.test.ts test/native-paper-contract.test.ts test/pilot-reporting.test.ts
node operator/reporting-delivery/build-publisher.mjs --source-checkout /absolute/pinned-a40c75e-reporting-checkout
node --import tsx --test operator/reporting-delivery/native-paper-projection-compatibility.test.mjs
npm run build
```

The test's dist input is the exact existing30148-byte publisher/hash
649f4cc27f74f3aa53fcc831a3437b7e3d9eb8eef63896782b5b451aba1427eb.
The local verification used a read-only symlink to that already-built bundle;
no reporting service or deployed publisher was rebuilt/replaced.
