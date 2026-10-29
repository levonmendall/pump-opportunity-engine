Pure read-only restart-history helper. No launcher integration, file I/O, RPC, ledger, financial permission or service changes occur here.

`readNativeProtectionHistory(input)` accepts the expected account/inception, known run IDs, actual read time, a versioned checkpoint and the previous private native status. It projects only maximum completed gap, maximum quote age, protection breaches and unavailable checks. Identity, chronology, known-run membership, source commit/hash syntax and every nonnegative safe-integer counter are validated. Other previous-status source/timing metadata may exist but is never restored.

Counters merge by MAX rather than SUM, so a checkpoint and status containing the same cumulative failures cannot double count them. A checkpoint with three known breaches and five unavailable checks retains those values through repeated restarts. Missing/corrupt optional statistics return an explicit unknown/lower-bound result instead of throwing or blocking financial management. `historyUnavailable` means neither input yielded valid counters; per-input flags indicate which source was accepted. The scope is ALWAYS `known-lower-bound`, including a valid zero count: this is never proof of complete historical coverage.

No previous completion timestamp, source/quote freshness, inventory, healthy-proof streak, order, permission or financial state is returned. The new runtime must obtain genuinely fresh protection evidence independently.

26 meaningful tests and TypeScript build passed. Historical failure fixtures are controlled inputs, not a new claim about unobserved runtime intervals. Root will wire the helper into the existing launcher and manifest in the combined repair.
