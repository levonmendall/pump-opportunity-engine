# Targeted transaction-flow feasibility

A bounded check proves that the pinned official PumpSwap2.2.0 IDL can decode one
actual direct canonical-pool Sell, including executed amounts, user, pool and
precise instruction/event identity. It does not prove an Alchemy stream works.
No application source, deployment, PAPER account, entry control or wallet changed.

Two chain samples were examined. The retained legacy transaction from the RPC
comparison was a protocol-fee sweep across several pools. It is not trade flow.
One additional public-RPC read fetched the other already-listed signature for
canonical pool `DtcDNMjNQjkqS2qBrB3xbHbQWy3jwYXq6BYLFhKQ2MVD`, mint
`2suCpXe3HaSqCZ2Bb4dgmRrJjuDDRqwYDUTEJ3Kypump`. There was no signature search,
provider connection, Alchemy receipt, secret use or transaction submission.

The successful version0 Sell, signature
`4MCi2CvSp1chEsMYVSBJN9ZTc87Bv1kLC7vFkiqr5kTd9HdqWJArFEFqnNqz87refwVFRYqvDwBpcaQ4LkVwvQZh`,
has outer instruction2 and event-CPI inner instruction5, event index0. Official
Anchor BorshCoder with the SDK's packaged IDL decodes the same SellEvent from
program-scoped logs and from CPI bytes after the exact eight-byte Anchor event
prefix `e445a52e51cb9a1d`. These are two representations of one event.

| Field | Verified value |
| --- | --- |
| Pool user |`BwJigd5taT26gAhNcv1DMrC7epkedHBjcgbWVbEMP8Q`|
| Executed base input |138353716808147 integer units|
| Instruction minimum quote output |1 lamport: a constraint|
| Executed user quote output |1462993 lamports|
| Gross curve quote |1481514 lamports|
| LP / protocol / creator deductions |297 /13779 /4445 lamports|

Token-2022/legacy TransferChecked instructions, the user's WSOL balance delta,
and pool reserve changes independently agree with executed quantities and rounded
fees. The transaction network fee is separate; token-account closure and another
system transfer make total wallet SOL change unsuitable as swap notional.

The IDL's BuyEvent also defines base_amount_out, quote_amount_in,
user_quote_amount_in, pool and user, alongside max_quote_amount_in and
min_base_amount_out constraints. That layout makes a bounded buy decoder plausible;
no Buy transaction was validated in this two-sample check. Never substitute a
minimum/maximum argument for executed notional.

Reproduction uses the pinned packaged `src/idl/pump_amm.json`, Anchor's installed
BorshCoder/EventParser, the existing raw transaction fixture and the IDL digest
recorded in `evidence/targeted-transaction-feasibility.json`. Convert bs58 output
to Buffer before instruction decoding. Recursively convert BN values with
`.toString(10)` before JSON: Anchor BN's default JSON serialization emits hex.
Use integer token-balance `amount` strings, not uiAmount or JavaScript Number;
retain signed128bit virtual reserves (here -47822).

A future adapter still needs actual authenticated Alchemy filtered-pool receipts,
confirmed/finalized semantics, full metadata/inner instructions, budget measurement,
reconnect/gap handling and proof of the current transaction-version range. The
reviewed blockSubscribe documentation's maxSupportedTransactionVersion0 cannot
be assumed to cover version1, which the migration integration has encountered.
This sample is version0 with empty lookup addresses; nonempty address-table
resolution remains untested. Resolve static keys, then loaded writable, then
loaded readonly before using compiled indices.

Only one direct swap invocation was observed. Routers, multiple swaps/events in
one transaction, missing stack heights, truncated logs, v2 layouts and account
extensions need separate bounded evidence. Deduplicate by signature plus exact
outer/inner/event identity and program, not signature alone; scoped logs and CPI
must not double count. A user key may be a router/PDA or common controller, so
wallet count does not prove independent participation. Failed transactions,
ambiguous attribution or unknown layouts cannot create executed flow.

The provider adapter remains unbuilt and disconnected. No coverage, latency,
three-way decision equivalence, economic saving or acceptance result follows
from these two chain payloads. Entries and live trading remain disabled.
