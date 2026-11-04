# Current PAPER operating capacity

The owner's November 4, 2026 instruction to maintain two simultaneous holdings where economically justified is applied as a **maximum of two held positions plus unresolved BUY reservations**. It does not require opening two trades. SELL orders retain their position's capacity until actual full settlement.

`owner-paper-two-holdings-v1` is a runtime operating policy. The native V3.1 launcher explicitly supplies it to the sole `PaperLedger` writer. A shared pure predicate applies the same count before financial preparation, trader admission and atomic new BUY reservation. An already completed idempotent order receipt remains replayable. Canceling an unsubmitted BUY releases its reservation; a failed attempt does not reserve a new position.

Existing holdings and accepted orders above the limit remain valid. The policy does not force liquidation or cancel accepted obligations, block their settlement, or prevent management, reconciliation, protection or exits. A newly available slot still requires current independently audited market evidence, exact-size executable economics and every existing financial safeguard.

The historical V3 and V3.1 bindings retain `maxPositions:null`, and the stored V3 equity policy retains `maximumPositions:null`, 500bps consumed-entry sizing and no daily-loss trading halt. Those immutable contracts describe the original financial epoch. They are not rewritten to express a later operating restriction. The two-position control is not a return to the earlier V2 daily-loss policy.

The policy object is included separately in `nativePaperConfigurationSha256` for V3.1. The previous immutable release used configuration `f030f068a845d28f0717bf3edabe8bba0483f55cc3cc2f95a6feedb634c10d28`; a package containing the new operating policy must compute and validate a new digest. It cannot reuse f030. Private status reports both the historical limit and effective operating capacity, including held positions and pending BUY reservations. Reporting must not infer this new policy for an older source that does not emit it.

The financial SQLite schema, epoch, original account, history and financial policy are unchanged. The runtime setting does not persist a new financial event or migrate existing rows. Its activation belongs to the ordinary reviewed source/configuration deployment, including natural-flat prerequisites and current-source operational verification.
