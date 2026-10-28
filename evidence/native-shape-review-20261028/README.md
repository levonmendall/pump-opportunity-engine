# Two retained unsupported shapes — offline findings and minimal historical checks

Source9a's ten unsupported-swap-label callbacks split five F5 and five AN4. Only the first raw representative for that refusal reason was retained, so its MultiHop shape cannot be assigned to all ten identities. `unsupported-ten-identities.json` preserves each exact refusal signature/slot and event reference.

No network request or runtime mapping change was performed in this review. Official SDK2.2.0 IDL events were decoded and exactly re-encoded; their original raw bytes, receipt/availability times and successful program-frame paths remain retained. SDK source/interface hashes are in `decoded-two-shapes.json`. These are program-authored semantics, not yet compiled-account or SPL-transfer proof.

## A. MultiHopSwap emits its own executed BuyEvent

- Signature:`21UdCqyUj1wWcVuPH7vbRL8YYCoHnbLzjRBJpJ9YoMk1N4DfUYTNwkpvbi7KkAnwZ5AKWwppezpbKjnEbfT4ycnu`; slot462580695.
- Mint:`F5v2odurfbucdViokrzwYNczrrTZuvHhnY8ofRU2pump`.
- Canonical pool:`89MFRL9ypWvMYsMvpGayei4rje6MDctEpoWqrSfuYWw8`.
- Raw source:`events/events-001.ndjson:451`; refusal:450; prior support:347. Prior support validated18:38:43.070UTC at bank slot462580693, bank Clock18:38:42, Token2022/MetadataPointer/TokenMetadata. This was fresh actual captured state, not current state now.

Outer router`6Vo3245eszAb5wuqEMw8mGdbfRUdKbHhDHP5LcaGuTAB` labeled MultiHopJupiterBuy invoked PumpSwap MultiHopSwap at depth2, which emitted its own508B BuyEvent at log index34. It then invoked Pump MultiHopCurveSwap. The BuyEvent pool is exactly the selected F5 pool: this representative is not a false refusal caused only by another pool's event.

The event says `ix_name=multi_hop_swap`, program user`D5V2LbmW8uPZrUomZH2ioAECCvxypoAmJadm1xnmv4GS`, base output20,914,680,636 units, gross quote22,581,424 lamports, net quote22,570,138, protocol fee11,286 and buyback slice5,643. Its user-base account is the zero/default address. That is consistent with an intermediate route leg paying directly to the next venue; it is not evidence that the final user received F5 into that placeholder.

Pinned SDK `src/sdk/multiHop.ts` and `offlinePumpAmm.ts` document real per-hop execution, not only a wrapper:16 fixed roles followed by five-account hop tuples `[baseMint,quoteMint,poolOrCurve,baseVault,quoteVault]`. Each buy hop spends exact input. Protocol fee applies to the first buy hop; creator/LP fees to the last. This example's zero LP/creator and nonzero protocol fee fit a nonterminal first leg. The buyback fee is a slice of protocol fee, not an additional independent debit.

The native parser refuses before accepting this unsupported label. The full mapper also assumes MultiHopSwap contains a separately recognized child ordinary swap; it will not establish this own-event case. Simply adding the label to `SWAPS` would invent normal role/transfer semantics and still fail variant agreement. A correct extension must bind the actual event to its remaining-account hop and direct vault transfers, preserve trader authority separately from fee payer, handle multiple legs/events without collisions, and use established exact-input fee conventions.

## B. BoostBuyAndBurn has a fifth token child after its events

- Signature:`4kp9ph7W3ziFuNvd2E1TpXgqydHzjquXaBHr6RYo7dDikkbJ5qvVmbRGj3oPkudVTrXpAtBYxaMVxU2iVnmEns7E`; slot462583391.
- Mint:`GwvVsrECK5dajqMQhh6FT5PcPX4ao5QipuZMbWQHpump`.
- Pool:`DTv86qoU5tLwCyL4gfrArkjy1o7UeWcVNQmKuWzqDZJa`.
- Raw source:`events/events-007.ndjson:3774`; refusal:3773; prior support:3570. Validated18:48:12.099UTC, bank slot462583366, Clock18:48:11, Token2022/MetadataPointer/TokenMetadata.

The root BoostBuyAndBurn has five children, while the current supported grammar requires exactly four: classic-token quote movement, Token2022 Burn, two event self-CPIs, then an extra unlabeled classic-token invocation at logs21–23. The current parser refuses `PROTOCOL_CHILD_SHAPE`.

Both official events exactly round-trip. Their protocol actor equals the derived boost-vault PDA and quote account equals its WSOL ATA. All seven reported fee amounts are zero. Pair time/amounts agree; all three integer reserve deltas agree with604,925,295 quote lamports and8,981,894,354,501 base units burned; boost quote remaining is zero. This is a protocol effect, never an ordinary buyer or user-received base quantity.

The extra child may close an emptied WSOL vault after execution. Logs alone do not identify its opcode or roles. Do not treat an arbitrary extra token invocation as harmless cleanup merely by changing child count4→5. The existing full mapper intentionally refuses protocol buy/burn, so low-level compiled/SPL inspection is required.

## Minimal on-chain evidence requested from the lead

Two historical `getTransaction` requests, one per exact signature above, with `{commitment:"confirmed",encoding:"json",maxSupportedTransactionVersion:1}`. Use the existing shared research accounting/gate; at most2MiB per response, no automatic retry. No signature-history scan, current account refresh or new capture is needed to answer these first field questions.

For A, compare exact retained logs and slot; decode compiled remaining-account tuples, route argument amounts and instruction/event positions; establish user authority/signers, base/quote vaults, SPL transfers and fee recipients; distinguish intermediate route output from final user output. Current mapper refusal must stay visible while its missing semantics are assessed.

For B, establish exact boost authority/vault/mint/fee roles, SPL transfer and burn amounts, and the fifth instruction. If it is CloseAccount, prove source is the emptied boost WSOL vault and authority/destination match legitimate cleanup. Do not assume this from the zero balance event alone.

`inspect-fetched-transactions.mjs` is an offline bounded reader prepared for the two response files. It checks fixed signatures/slots/exact retained logs, pinned instruction round-trips and emits real compiled positions, roles, remaining-account groups and raw token opcodes. It constructs no blockchain instructions and performs no network requests. It has passed syntax checking only until actual response files are supplied; its existence is not successful transaction validation.

```bash
node evidence/native-shape-review-20261028/decode-retained-shapes.mjs
node --check evidence/native-shape-review-20261028/inspect-fetched-transactions.mjs
node evidence/native-shape-review-20261028/inspect-fetched-transactions.mjs /PRIVATE/first-response.json /PRIVATE/second-response.json
```

The two reads can resolve these two representatives. They cannot prove the other nine unsupported-label cases have identical shapes, repair earlier windows or backdate later validation into a past decision.
