# Candidate ranking and 24-hour token scope

Owner request: remove the unbounded queue-wait scheduling bias and consider only tokens no more than 24 hours old for new PAPER entries.

## Ranking

The four existing broad-feed economic dimensions remain unchanged. Priority is now economic merit plus an additive waiting bonus of at most 0.05, saturating after 60 seconds of serviceable waiting. The 0.05 value is an explicit scheduling choice, not an optimized profitability claim. It cannot reverse a merit gap greater than 0.05. Missing dimensions remain neutral for exploration; waiting cannot multiply them without bound. Selection records include the bonus, no-bonus economic leader, leader merit and whether waiting changed the winner. Financial/technical retry ordering is otherwise unchanged.

## Age means token creation, not migration or discovery

The persistent V3.1 PAPER runtime now requires a successful finalized Pump `create` or `create_v2` transaction with a matching mint, canonical bonding-curve address and child SPL mint initialization. Its actual block time supplies the birth timestamp. A fresh PumpSwap migration, first-seen time, refreshed account proof or subscription ACK cannot make an older token young. Exactly 24 hours is included; 24 hours plus one millisecond is excluded. Unknown or invalid age is ineligible.

Existing PumpPortal creation signatures are retained by the current discovery feed. Only market-relevant candidates with a retained creation signature are sent for one targeted finalized transaction lookup through the existing shared RPC scheduler. This does not scan historical transaction pages or request a transaction for every launch. Confirmed-but-not-finalized/null and provider-unavailable outcomes remain unavailable and are retried no sooner than 60 seconds later, within existing provider/protection budgets. A verified birthday is persisted and never refreshed. A missing historical creation signature remains unknown rather than borrowing migration age; initial coverage can therefore be narrower until recent creation evidence is available.

The gate applies before normal/technical-retry deep allocation, when current observation membership is checked, during financial qualification and reservation, and immediately before modeled entry execution. Unfilled buy orders that cross the cutoff are canceled through the existing sole ledger writer, with no fabricated fill or gas charge. Held positions and sell orders retain their existing exit policies. Durable identities, original account, financial epoch, balances, trade history, four-slot limit and PAPER-only mode are not reset or replaced.

The existing market-registry database receives two additive nonfinancial tables for immutable creation proofs and lookup retry state. The financial schema is unchanged. Runtime configuration includes both policy versions. Reporting names the actual creation-age scope, its verified eligible population, and unknown-age exclusion. Offline fixtures are not production acceptance.

## Validation required before source switch

Typecheck, focused policy/registry/watch/runner/execution tests, full offline suite, exact immutable bundle build and normal approved EC2 installation. Verify installed source, original account/history, new policy scope, creation-proof progress, four-slot lifecycle and holding exits. Host release approval remains independent; a repository commit or package build is not proof of deployment.
