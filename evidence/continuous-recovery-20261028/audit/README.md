# Adaptive history pages and executed-flow audit scope

Changes are limited to the existing auditor/session and their focused tests.
No network, deployment, financial ledger, source/account reset or additional
provider allowance was used. The failed e7ffe50 interval is not rewritten.

Compatible opt-ins (defaults preserve all-notification/fixed-page behavior):

- `adaptivePageSizing: true` with `pageLimit: 1000` chooses100 when the captured
  target has fewer than100 required signatures, otherwise1000. A full100-row
  response that has not reached the independently validated lower fence can
  escalate the NEXT physical page to1000. A short uncovered page is unavailable,
  not an invitation to retry. The same strict cursor/context/row checks apply.
- `completenessScope: 'executed-transactions'` allows only missing history rows
  independently reported confirmed/finalized with a nonnull nonempty failure
  object. All missing rows remain in `missingNotifications`; failed/successful
  subsets are retained separately. Such a result explicitly has
  `notificationCompletenessVerified:false` while
  `executedFlowCompletenessVerified:true`. It never claims packet completeness.

An absent successful row remains blocking even if it might be a nontrade: the
history response cannot establish its instructions or amounts. Captured failed
hints absent from independent history remain blocking too. Status disagreements,
corrections, ambiguous boundaries, unsupported/malformed confirmation status,
missing lower range, context-floor errors, timeouts and cancellations still fail
closed. No failed history row is invented as a trade, wallet or amount.

Each actual request and retained page records `requestedLimit`; the session exposes
that limit before dispatch. A1000-row payload is rejected if only100 was requested.
Physical page count remains at most4, and original10-second decision/elapsed
bounds are unchanged. `pageLimit` in the result is the configured maximum, not a
claim that every request used it. Filtering already received failed rows creates
no RPC or incoming-byte saving; all pages needed to reach the fence still execute.

Completion flags are assigned only AFTER the final admission-clock check. A review
caught a new metadata bug where flags could remain true after that check threw;
`final-clock-before-fix.log` preserves the failing counterexample. Both elapsed
and clock-regression cases now clear every completeness flag. The source history
remains diagnostic while the final result is unavailable.

## Verification

Current focused audit/session/batch suite:65passed/0failed. Build and compile
passed. Raw output, exact owned-file hashes, command/exit/time/SHA256 receipts are
under `verified/`. A final formatting-only whitespace cleanup is followed by a
second65-test focused run and an explicit receipt; the earlier build/compile
receipts retain their actual pre-format hashes. Root owns final integrated full
repository verification after all workers settle.

Meaningful new fixtures cover103-row sparse history (100then1000,9interior rows),
2200-row busy history (three separate1000-page requests), actual-limit payload
validation, four-page truncation, short-page non-escalation, failed versus
successful missing rows, status reversals, unavailable independent failure proof,
malformed failed status, physical refusal/elapsed failure, cancellation/deadline
between adaptive pages, and final admission-clock failure. They are synthetic
mechanics, not forward provider capacity or completeness evidence.

Two preliminary failures are retained: a99-row test fixture initially placed
rows above its anchor (the validator correctly rejected it), and a batch regression
exposed changed mixed-missing failure priority. The fixture was corrected and
legacy failure priority restored without weakening validation. No successful
historical result is manufactured from either failure.

Root/runner owner must explicitly freeze the new audit-profile version and pass
both opt-ins. This work does not edit the runner or enable PAPER qualification.
