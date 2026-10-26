# Operating cost accounting — separate from PAPER execution

The pure costs module aggregates operating expenses for one identified account.
It does not open a database, send provider requests, move money or enable trades.
The authoritative PaperLedger must journal each operation through its existing
single-writer/idempotent action path before this summary is used in reporting.
Until integration and actual source coverage are established, economic P&L stays
unavailable; passing offline fixtures is not an operating-cost receipt.

Required categories are data, RPC, hosting, backup and transfer-networkfee.
Amounts are classified actual, estimated or allocated. Mixed evidence stays
labeled mixed; estimates/allocations do not become actual expenses.

## API and persistence contract

- initializeOperatingCosts(accountId, inceptionAt) creates unknown coverage and
  zero *known subtotal*, without asserting that actual expenses were zero.
- applyOperatingCostEvent(state, event, now) validates and returns a new JSON
  state. It never mutates the caller's object. Supported operations are expense,
  coverage and later valuation of an original unvalued SOL expense.
- validateOperatingCosts(state) rejects missing/damaged persisted fields instead
  of silently filling financial information with zeros.
- validateOperatingCostEvent(state, event, now) checks applicability without
  mutating state or reserving an event ID outside the financial writer.
- projectOperatingCosts(state, {asOf, now, tradingPnlMicroUsd}) gives bounded
  projections. It is a current/nonhistorical projection, not a reconstructed
  historical expense curve.

Trading P&L supplied to the projection already includes modeled execution costs.
The economic result subtracts operating costs once; it never subtracts simulated
execution gas, pool fees or slippage again. Wallet funding principal, retained
wallet balance floors and returned refundable account deposits are assets or
capital movements, not operating expenses. Such category/event types are refused.
The real network fee for an approved operating-wallet funding transfer belongs
in transfer-networkfee, separately from its principal.

The summary stores category/classification totals, unresolved SOL aggregates,
current coverage attestations, and at most50 recent expense/valuation operations.
The full source detail, action IDs and original financial evidence remain in the
existing journal. There is deliberately no second all-history idempotency registry.

The caller MUST apply each expense/coverage operation through its durable action
ID. For later valuation it MUST obtain and authenticate the exact original
unvalued SOL expense from that journal, then use a once-only action identity tied
to the original expense ID (for example operating-valuation:<expenseId>). The
module checks the bounded cached original when present, but cannot authenticate
an evicted original or prevent a second resolution by scanning an absent registry.
Never accept an unverified original-expense object from a viewer or network input.

Estimates and actual invoices for the same obligation must not both be appended
as independent expenses. A correction/reclassification must replace or rebuild
that obligation through the authoritative journal before publishing totals; this
small summary has no estimate-to-actual reconciliation registry. Refunds/credits
also need an explicit journal-backed correction, not a negative expense slipped
into the unsigned amount API. These operations are not yet integrated here.

## SOL valuation and uncertainty

USD expenses use exact integer micro-USD. SOL expenses retain integer lamports
and use a timestamped incurrence-time SOL/USD observation no more than10seconds
older than the actual expense. A newer current price cannot be substituted for
a missing historical price. A later supplied historical observation can resolve
the unknown only when it really was available for the original incurrence time.

Without such a valuation, the expense remains counted as unresolved SOL and
economic P&L is null even if coverage certifications otherwise look complete.
Unknown expenses are not lost when their recent display rows are evicted.
Each known SOL expense rounds upward to a whole micro-USD; the explicit maximum
rounding overstatement is less than one micro-USD per valued operation. This avoids
reporting a small known fee as free.

## Coverage and source times

Every category defaults to unknown. A source-backed complete attestation must
cover the account's actual inception through the requested asOf time. Its interval
cannot extend into the future. All five categories must be covered and every SOL
expense valued before operatingCostsMicroUsd is available. Trading P&L must also
be known before economicPnlMicroUsd is available.

A complete assessment with no expenses can establish an actual zero; the absence
of events cannot. A partial interval, gap or explicit unknown replacement leaves
economic P&L unavailable. Coverage updates replace that category's current full
assessment; they do not silently fill gaps by stitching intervals. A new reporting
heartbeat does not extend the evidence's through time.

Use coherent fact times when projecting. Retain unknown historical economic chart
points; later knowledge must not be relabeled as something known earlier.
Actual invoices, provider usage/charges, approved fee receipts and documented
allocation sources still need to be supplied. This module assumes no cloud rate,
no zero-cost hosting, no funded wallet and no completed operating acceptance.
