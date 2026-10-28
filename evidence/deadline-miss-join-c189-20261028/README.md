# c189 audit-target and physical-operation join

Actual frozen source `c189a54b7978692ef2f7d098d6b3374aea8deb72`, run `native-paper-20261028210805129`, GH40769349583. This is an offline join of the hash-verified, allowlisted metadata archive; it is not full raw market replay, provider root-cause proof, or a scheduling repair.

All **14 expired decision windows** match **14 of the20 unavailable audits**, each caused by a real `getSignaturesForAddress` physical HTTP timeout. There were **zero expired targets without an audit session/result**. Six other unavailable targets retired immediately after their third consecutive timeout, before a later expiration callback. Therefore14 expiration records must not be added to20 audit failures as34 separate lost targets.

Each failed request had **no HTTP headers and0 response bytes** before its1.5s timeout. Physical enqueue-to-start was7ms median/9ms maximum. Timeout callback lateness was0.162ms median/1.231ms maximum; cancellation settlement took23–25ms. The failures occurred with **6,012–6,664ms of the original decision runway still unused**. These are genuine unavailable-evidence outcomes, not demonstrated dispatch starvation or seconds of event-loop timer starvation. A decision-window expiration correctly states that no valid decision existed by the cutoff; calling each a separate scheduler deadline violation would misattribute its cause.

Six pools each produced three consecutive first-page failures: all18 targets had **zero captured notification rows**. The other two failures occurred on page2 after successful page1 responses:149.7ms/23,089B and98.3ms/23,445B. Their second physical requests began2,146ms and2,432ms after their target boundaries, respectively, then timed out without headers. Multipage continuation was actually dispatched; the full required history was not obtained.

First eligibility-to-page1 physical start was1,836ms median/2,445ms maximum. Nineteen of20 failed targets recorded two ceiling-refresh attempts, and the last dispatch context for every failed target reported one ready candidate. This identifies required source-ceiling preparation in their paths but does not prove it caused the response failures or that all possible simultaneous-ready workloads are supported.

Provider/backend latency, network path, HTTP dispatcher/connection reuse, and response latency beyond the right-censored1.5s cutoff remain unresolved. No provider-rate saturation inference follows from this join. Queue-priority changes alone cannot be claimed to repair these headerless response failures. The complete contention repair remains useful for separately demonstrated source-level blind spots and explicit stress conditions, but its forward result must distinguish those mechanisms.

Mandatory executed-flow evidence was not obtained; it cannot be waived to certify a positive qualification. The18 zero-observation targets do raise a separate efficiency question: a safe no-entry/defer policy need not claim a verified predictive rejection. Any such change would alter allocation/coverage and must be separately labeled and measured, without treating unobserved flow as absent. No such policy is implemented here.

`cases.json` contains every20 unavailable target, all22 attempted page joins, original timestamps, unused runway, expiration/retirement disposition, and source-file/line hashes. Reproduce:

```bash
python3 evidence/deadline-miss-join-c189-20261028/analyze.py
```

No network request, ledger access, financial write, runtime change, or deployment occurred.
