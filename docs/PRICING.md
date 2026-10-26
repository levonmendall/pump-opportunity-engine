# Supported current-state pricing

The integration and held-position paths use the pinned official PumpSwap SDK
2.2.0 and the same canonical pool/state verification. They construct no
transactions and cannot sign or submit them. These code changes are offline
engineering work, not deployed trading or forward performance evidence.

## Entry and actual holding sizes

quotePool(rpc, mint, buyLamports, recorder, minimumSlot) retains the original
size-specific buy plus corresponding same-state independent sell. The buy
capacity remains greater than10lamports and at most1SOL; accounting applies
the separate $50/position and aggregate risk limits.

quotePositionSell(rpc, mint, fullBaseUnits, recorder, minimumSlot) prices that
exact token quantity directly. It has no hypothetical buy requirement. The caller
must pass the actual ledger position.units; the accounting path separately
requires an exit quote for exactly those held units. Quantities must be positive
u64 values and cannot exceed the mint's current supply. Zero rounded output,
unsupported token behavior, missing state or insufficient real quote liquidity
is an unavailable exit, never a fictional fill or removal of the holding.

The shared read checks canonical SOL pool PDA/creator/index/LP mint, programs,
vault addresses/owners/mints/behavior, initialized mints without mint/freeze
authority, supported Token-2022 extensions, global instruction-disable flags,
current fees, signed virtual reserves and retained protocol/creator fee buckets.
Returned RPC slots must be safe integers and satisfy the requested minimum;
the full batch cannot regress behind the initial pool-link read.
It uses the SDK's effective reserves and real-vault payout constraint. Raw
vault balances alone do not establish pricing or available exits.

## Costs already embedded in quotes

A sell exposes the SDK's gross curve output and net output. Their integer
difference is the aggregate embedded pool deduction for the supported legacy-SOL
quote mint; no quote transfer-tax model is needed for this restricted scope.
The SDK's dynamic fee rates and integer rounding remain authoritative. The
creatorFeeApplied flag distinguishes whether the pool's creator field activates
that schedule component.

The exact-in buy SDK returns its internal curve input, but does not return an
itemized charged-fee breakdown. buyBudgetAboveInternalCurveInputLamports is
explicitly a fee-budget/rounding difference, not an invented precise fee invoice.
The existing buy/correspondingSell shapes remain compatible with captured proofs.

Embedded deductions already affect the token or SOL proceeds. Do not debit them
a second time. Network/priority costs remain explicit simulated execution costs
outside this layer. A liquidation mark must subtract those exit costs at actual
size; if proceeds cannot cover them, report uncertainty/liability rather than a
fresh zero. Account-deposit refunds require separate closure evidence.

## Account creation and freshness

Official SPL extension mapping gives required associated-token account bytes:
currently165 for supported legacy accounts and170 for supported Token-2022 ATAs
including ImmutableOwner. Both base and quote requirements are reported. These
are byte requirements, not rent prices or proof that an owner account exists.
rentLamports remains null until a current rent RPC quote and account-existence
assessment are available. Refundable creation deposits are locked assets, not
automatically permanent fees.

Each result retains confirmed slot, batch request/receive time, underlying block
time, validation time and the existing30-second maximum block-age boundary.
Validation time does not refresh an old receive or market time. Execution/mark
adapters must enforce their tighter freshness limits on the original facts;
these integration bounds alone do not prove a usable two-second execution quote.

One pricing call makes the existing three bounded RPC reads: pool links, coherent
pool/config/mint/vault batch, and block time. The current ReadOnlyRpc adapter has
a100-call integration cap. It is not a production daemon RPC scheduler or a
coverage/SLA claim; no new provider or paid RPC was introduced.

Tests replay the two retained real pool records without network calls. Synthetic
extension/retained-fee perturbations are explicitly regression fixtures, never
new observed market data, account balances or performance.
