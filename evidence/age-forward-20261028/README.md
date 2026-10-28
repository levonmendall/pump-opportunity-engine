# Frozen migration-age forward scorecard

The corrected interval reached six concurrent scopes and evaluated 17 distinct tokens, but did not complete its planned 900 seconds. It stopped after 765.250 seconds with `bounded resource reserve reached`. Five tokens received observation allocation below five minutes; none received a timely, independently audited early predictive assessment. This is a coverage limitation, not proof that the early strategy failed.

| Actual interval | Source | Distinct admitted | Distinct assessed | Feature windows | Retrospectively audit-covered | Timely assessments | Predictive passes |
|---|---|---:|---:|---:|---:|---:|---:|
| 01:58:09.342–02:03:27.786 UTC | `1657bb4` | 4 | 3 | 3 | 3 | 3 | 0 |
| 02:20:44.929–02:33:30.179 UTC | `e69ad8b` | 22 | 17 | 36 | 33 | 32 | 0 |

Both intervals used configuration `4f159a554019e1d9c52af7df825b4ccbd4e43dedae5ead7ef771013c2001a18d`, frozen buying rules, candidate-only mode, and zero financial-entry-enabled time. The second interval's 33 audit-covered endpoints represent 1,930 candidate-seconds of union-covered lookback, not 1,980 independent seconds. Their distinct wall-time union is 650 seconds. One FB5… window ending 02:26:40 only obtained audit coverage at 02:26:55.134 and did not receive a contemporaneous predictive assessment.

Early observation outcomes are individually retained in `final/scorecard.json`:

- E2Qt…: two early feature windows; independent-history verification unavailable. Later assessments are separate observations.
- HKB…: one early feature window; independent-history verification unavailable.
- 4Cg4…: repeated unsupported Boost buy/burn mapping losses before five minutes.
- Fssj…: unsupported Boost buy/burn mapping loss.
- 7sD23…: aggregate enrichment-capacity loss.

No early result is relabeled as a strategy rejection. Normal warming is separate from these recorded failures. The source scorecard includes every promotion, fresh-window interval, audit availability time, predictive predicate result and scoped failure.

`final/scorecard.json` uses 101 strictly redecoded original confirmed/finalized migration identities from bounded archived records. Current index-created times supply no age bin. The five frozen independent indexed leads remain a biased, nonexhaustive control population; only FRONGUS has a joined retained strict origin in these inputs, and neither interval admitted it. Its historical support, execution outcome and missed profit are not inferred. The reference snapshot overlaps the adverse interval and predates the corrected interval; it is not a census at the corrected run's start.

Reproduce offline from this checkout with its existing dependencies and retained private research archives:

```bash
prlimit --cpu=60:65 --nofile=64:64 --fsize=16777216:16777216 -- \
  node --max-old-space-size=512 --import tsx scripts/score-age-forward.mjs \
  --out=/tmp/poe-age-forward-reproduction
```

The command refuses an existing output and requires both target runs' settled results by default. It reads at most 32 MiB per file, limits the archived universe to runs no later than the corrected interval, and makes no network or database calls. Per-token first-admission cohorts, allocated-time cohorts, window-end cohorts and actual assessment-age cohorts are explicitly distinct. No fill, $50 quote, fee, P&L, optimum entry age or market-recall percentage is manufactured.
