# Compiled drained boost-vault close proof

The supplied successful historical transaction (`boost-close-actual.json`, original raw SHA256`9701cc3c6e6c3f52dfb0ca3acfd8b53920d2e2d96edd4f2f172d883ac8043aba`) proves the previously unknown fifth token child is Classic Token **CloseAccount**, opcode09, after the actual quote transfer, Token2022 burn and two self-event CPIs.

The narrow helper `verifyBoostVaultCleanupTransaction` validates actual supplied transaction bytes and exact retained logs; it performs no RPC call, instruction construction, wallet operation, financial write or normalization. It checks the canonical SOL pool and ATA relationships, pinned boost interface, required authority signer, boost-vault PDA/ATA, exactly five direct child positions, exact SPL programs/opcodes/accounts/amounts, paired official event bytes and roles, zero fees, reserve deltas, actual pre/post token balances, drained WSOL account closure and positive reclaimed account lamports.

Actual result:604,925,295 quote lamports transferred;8,981,894,354,501 base units burned; minimum8,785,124,403,407; boost remaining0;1,488,440 existing account lamports reclaimed to the compiled instruction authority. The protocol actor is the boost PDA, not the fee payer or an ordinary buyer. No user base quantity or strategy trade is created.

The proof's `transactionSha256` hashes `JSON.stringify` of the supplied object; it is distinct from the original raw response file SHA above. Event byte hashes, full notification hash and compiled positions remain separately identified.

This helper does not establish source freshness, information availability, current quote validity or the completeness of unrelated instructions. The caller must preserve actual full-transaction availability and original packet receipt time. A historical proof obtained later cannot repair or qualify an earlier window. Logs-only five-child payloads remain unsupported unless the caller explicitly supplies and validates this compiled proof; the existing four-child protocol grammar remains unchanged.

Focused verification used the actual historical response plus labeled offline mutations of every close role, program/opcode, amount, child count/depth/order, event identity, balance/owner, signer, success and envelope bound.23 helper tests passed;47 tests passed when combined with existing protocol/classic-burn regressions. Repository build passed after the new helper's literal return type was corrected. The independent reviewer found and verified correction of an unsynced-SOL-deposit exact-refund bypass; final helper review is GO. Parent parser integration remains separately reviewed.

```bash
node --import tsx --test test/protocol-cleanup-proof.test.ts test/protocol-pool-effect.test.ts test/protocol-classic-burn.test.ts
npm run build
```
