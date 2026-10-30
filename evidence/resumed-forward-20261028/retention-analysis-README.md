# Retention and independent-audit analysis

This is offline analysis of hash-verified, settled public native-candidate exports.
It does not request market data, open a financial ledger, change source, replay
prices or infer profitable outcomes.

Reproduce into a NEW output file:

```sh
node --max-old-space-size=384 evidence/resumed-forward-20261028/analyze-retention-audits.mjs \
  --artifact /workspace/poe-pilot/runs/native-retention-20261028142017/artifact \
  --output /ABS/NEW-analysis.json
node --test evidence/resumed-forward-20261028/analyze-retention-audits.test.mjs
```

The four tests are explicitly synthetic analyzer mechanics: page/candidate
attribution during interleaving, overlapping-window unions, explicit429 versus
local refusal, failed-page attribution, partial callback normalization and
artifact tampering. They are not provider or trading evidence. Raw output and
source/test hashes are in analyzer-tests.log and analyzer-tests-receipt.json.

The v2 actual analysis is forward-retention-audit-analysis-v2.json. The earlier
forward-retention-audit-analysis.json and previous-failure-retention-audit-analysis.json
were first drafts: their initialized per-candidate normalizedTrades zero did not
establish per-mint normalization. V2 labels that uncomputed field null and
separates terminal-row normalization accounting; old outputs remain historical.
Global observed counts were unchanged. Previous-failure-retention-audit-analysis-v2.json
matches all10 retained original failure-forensics checks. None is corrected replay.

forward-causal-findings.json cites exact raw file/line/hashes for two expired
windows, the late-snapshot signature and the single shadow predictive pass.
The original artifacts remain immutable. The first expired target was initial
independent lower-fence warming; the second had an actual1500ms physical timeout
withHTTP200/partialbody. Neither establishes sustained scheduler starvation.
The one history-missing signature was actually received after target close and
snapshot creation, during the audit. Never backdate it into the earlier window.

Six ACKed scopes were observed54.583s in total. The hottest one-connection scope
had5450unique notices in36.915s, exceeding the old4096 cap while remaining below
the new8192 cap. No new ledger overflow or compaction was proved by the sparse
retention snapshots. All observed successful audits used one page; live multipage
and six-busy fairness remain unverified. Peak physical request demand43/min was
below both60 and90; the higher research ceiling was not binding.

The only shadow pass, HuUg, was3.625533minutes post verified migration, with
strict-v2 baseline unavailable due protocol effects. It was not financial
qualification and has no paired executable entry/exit or profit evidence.
