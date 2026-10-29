# Holding protection and discretionary SDK continuations

This is a source repair and controlled SDK validation, not proof that the new code is installed or that it caused the actual 2026-10-29 12.329-second gap. Current runtime hard-protection pauses must remain until the combined repair and a separately reviewed recovery proof are validated.

## Critical path and failure domains

The production main loop serially awaits a complete NativePaper.candidate workflow. Its declared 9-second phase bound measured elapsed time but did not interrupt it. PilotMarket.prepareEntryCosts performed cold SDK support discovery/coherent state reads followed by one rent read per distinct account size, using a caller signal with no preparation deadline. Individual RPC admission limits did not bound the entire compound continuation. Holding context and discretionary support/buy shared a PilotMarket active flag and a ResearchClockPositionPricer busy flag, link working set and global highestSlot. An unrelated candidate's newer bank could therefore change the holding read's floor; attempting concurrent protection within that same pricer would fail rather than provide an independently priced holding.

All physical operations still use the same PilotRpc, global request rates, connection budget and single physical operation. This repair does not add an HTTP channel, provider allowance, service, account, writer, subscription or financial action.

## Implemented correction

PilotMarket now has separate held and discretionary pricers inside the same adapter and shared RPC budget. Held per-mint known floors, same-context whole-inventory pricing, Clock validation, actual-size requirements and temporal checks remain mandatory. An unrelated candidate bank cannot raise the holding domain's private highestSlot. Cold first holding pricing may need its own dependency discovery; warm one- or two-held valuation still uses one coherent union read.

Entry-cost preparation has a bounded whole-operation AbortSignal, defaulting to the existing <=3-second adapter timeout and optionally clipped by caller-provided financial runway and the original certificate deadline. The caller's expiration is not physical-settlement evidence: candidate ownership remains until actual continuation settlement, late plans are rejected, and retirementReady() remains false while unsettled. NativePaper maintenance must skip replaceable retirement while this gate is false.

beforeEntryPreparationRead is invoked only between the physical SDK reads of entry-cost preparation, never from a buy decision/execution quote inside PaperTrader.tick. The owning scheduler may use this safe continuation boundary to run a genuinely fresh whole-inventory protection turn before the next discretionary read. It must check trader/RPC idleness and remaining provider/financial capacity; the hook is not an independent timer or permission to overlap requests. Context access during candidate work is permitted only within this explicit preparation-yield window. Normal concurrent/unsettled guards remain closed.

ResearchHeldMarket now retains bounded static interruption categories and historical counts without exporting arbitrary provider messages. Failed/partial pricing remains unavailable; a later success does not erase the failure count or manufacture a completed protection check. The parent must project these facts through the existing source-bound operating report.

## Controlled evidence

The tests use retained actual pool/mint/vault/fee account bytes and the real SDK decoder, disposable ledgers, and explicitly synthetic timing/Clock/provider responses. They prove two held quantities can be freshly valued through one warm union batch while preparation yields, the preparation hook cannot reenter decision/execution quotes, timeout cannot publish a late plan or release physical ownership, a canceled yield starts no request, unrelated candidate slots do not poison the holding domain, and own holding slot regressions/stale Clock still fail closed. Existing complete NativePaper two-position, owner/hard-stop, delayed execution, technical reevaluation, independent exits, and uncertain-restart tests remain included.

No source changes were made to NativePaper, Ledger or the main loop in this branch. Combined scheduler/caller wiring and independent adversarial review remain necessary. The original operating account, its financial database, EC2 service and providers were not accessed by these tests.
