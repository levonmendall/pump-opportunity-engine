# Narrow observed MultiHop support

This change establishes one actual first-pool leg: canonical Token2022-base/SOL PumpSwap pool → one Token2022 Pump curve. The Pool's `MultiHopSwap` frame emits its own BuyEvent; it need not call a legacy Buy child. The existing wrapper-only assumption excluded this executed trade.

The original confirmed transaction is `../multi-hop-actual.json`, raw SHA256 `35230ba1673b68d2fc24ef47e1dbb04d3dfc59cf5367912e568e93de0b0a5684`. It was independently retrieved at **1793215281860** in the separately accounted `historical-adjudication-20261028192120` two-request diagnosis. Its blockTime1793212722 and original notification log position34 are distinct timestamps/identities. The historical read cannot repair the original failed window or make a timely earlier financial decision.

Actual selected pool leg:

- Pool89MFRL9ypWvMYsMvpGayei4rje6MDctEpoWqrSfuYWw8 / F5v2odurfbucdViokrzwYNczrrTZuvHhnY8ofRU2pump.
- UserD5V2LbmW8uPZrUomZH2ioAECCvxypoAmJadm1xnmv4GS comes from the official event and compiled `user` role; the full transaction confirms a required signer. It happens to be the fee payer here, but a synthetic distinct-fee-payer regression keeps the actual role.
- Gross user SOL debit22,581,424lamports; curve input22,570,138; protocol fee11,286, of which5,643 is the buyback slice. Do not subtract that slice a second time. Base output20,914,680,636units goes directly from the selected pool vault to the next curve's quote vault.
- The user receives the final AW9JF… token, **not** intermediate F5v… base into a user ATA. The compiled mapped row retains this route explicitly. Only this pool leg's amounts/fees are mapped, not the downstream curve's costs or a synthetic whole-route fill.
- Genuine compiled identity is outer2 / AMMinner2 / eventinner5. Native identity remains actual log34 / frame9; it does not invent compiled positions, transaction completeness or SPL proof.

The native decoder checks the exact official own-event amount convention, fee masks/rounding, reserve/output relationship and observed invocation grammar. It requires actual current support to identify the base mint owner as Token2022. `transferChecks` and compiled identity remain unavailable in native-only evidence. The full-transaction decoder additionally checks pinned compiled layout, program/fee/global/event PDAs, route and ATA relationships, signer user role, exact CPI positions/depths, SPL transfer amounts/accounts/programs, event bytes/log binding and relevant whole-transaction token-balance deltas. Other AMM calls or outside access to protected vaults remain unsupported.

Other MultiHop directions, venues, hop counts, transfer-fee forms, fee masks and base programs remain explicit refusals. Existing legacy/direct/routed Buy/Sell checks are unchanged. The separate compiled drained-Boost helper is not automatically wired into native flow; a five-child Boost notification still requires its genuine compiled proof rather than silently becoming an ordinary buyer.

Two implementation defects were found during offline validation and corrected before release: SDK MultiHop spends the full budget after rounded fees (preliminary net can differ by one lamport), and an event-CPI's account list now must be exactly the one event authority. The broader focused run initially failed one legacy **error-classification** assertion; restoring the existing `RELEVANT_SWAP_WRAPPER_WITHOUT_SUPPORTED_CHILD` prefix preserves that refusal and adds narrow route diagnostic detail. Original failure output remains alongside corrected results.

Independent reviewer `/root/recover_mapper_work/review_observed_multihop` reproduced the rounding issue, then reviewed the correction and the native/full parity and negative cases: **GO for this narrow mapper**. The earlier compiled Boost helper has its own independent review in `../compiled-cleanup/independent-review.md`.

```bash
node --import tsx --test --test-concurrency=1 test/observed-multi-hop.test.ts test/protocol-cleanup-proof.test.ts test/program-log-mapping.test.ts test/program-log-identity.test.ts test/pumpapi-mapping.test.ts test/pumpapi-exact-buy.test.ts test/pumpapi-short-exact-buy.test.ts test/pilot-mapper-forward.test.ts test/instruction-layout-callers.test.ts test/protocol-classic-burn.test.ts test/protocol-flow-evidence.test.ts test/protocol-pool-effect.test.ts
npm run build
```

Offline matched evidence proves this decoder's observed shape. It does not establish future full-market coverage, audit capacity, a complete new live candidate window, a strategy pass, executable profitability or production readiness.
