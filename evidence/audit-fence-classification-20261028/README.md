# Independent audit fence warming classification

This is an offline diagnostic correction to the existing native candidate runner.
The actual source63f4 run and its two recorded deadline-counter increments remain
unchanged. No RPC, trading, ledger, provider or production action was performed.

Actual Ag9 evidence showed ACK138ms before the first aligned target start, no
post-ACK/pre-target independent lower fence, no history request, then the next
window independently verified. Treating that first raw-complete window as a
scheduler deadline miss conflated audit warming with dispatch failure.

The runner now computes lower-fence readiness before scheduler admission, using
the same helper as actual audit construction. Missing evidence is recorded once
per target as `native-independent-audit-warming`, `windowUsable:false`, and
`deadlineEligible:false`; the public source counter is `auditFenceWarmingWindows`.
The window does not qualify, consume a quote, or become verified. A new complete
window rechecks the prerequisite. A valid post-ACK context short-circuits the
ledger lookup; actual audit construction reuses its single captured ledger.

Fence-ready work remains deadline-eligible even when the shared physical gate
prevents every dispatch. A physical history timeout still creates a genuine
unavailable evaluation and deadline miss. Closed-window identity, source
generation, context floors, six closed10s buckets, current audit result, original
10s decision deadline and all financial refusal rules remain unchanged. ACK resets
these replaceable per-generation timing fields; it never carries old readiness.

Four synthetic regressions cover the observed138ms timing shape, actual starvation
before dispatch, partial physical timeout, and no redundant busy-ledger copies.
The unchanged existing late-audit/current-generation and multipage tests are also
run. Fixtures are not corrected historical market replay or forward readiness.

`before-repair.log` retains the original semantic failure (1deadline where0 was
expected); two other added checks also failed because the new warming counter did
not exist yet. Do not represent those as three separate proven runtime defects.
The original source bytes and receipts are preserved. Intermediate validation
preceded the independently reviewed ledger-copy improvement; `final/` contains
the authoritative exact-file-hash verification for the final repair.

Commands:

```sh
node --import tsx --test test/native-candidate-runner.test.ts \
  test/native-audit-session.test.ts test/native-flow-audit.test.ts
npm run build
npm run compile
npm test
```

Every output is retained raw with SHA256/time/exit receipts. Verification uses an
explicit base commit plus exact modified source/test hashes, rather than claiming
uncommitted files were already part of the base commit. No source file changes
while each recorded verification interval runs.

Independent read-only review: GO after removing an invalid test property access;
that correction preceded final verification. The reviewer checked first-window
warming, fence-ready starvation, timeout, generation reset, late results, and
per-window coalescing. The copy optimization is measured by an instrumented
fixture (0ledger reads during ready-context classification behind a busy gate;
1captured ledger for an actual audit), not by a claimed live CPU saving.

Final result:58focused checks,1205full tests, build and compile all PASS.
